// The token launch radar's model: pure functions of the sealed snapshot.
// No clock, no randomness, no network: the same snapshot always yields the
// same board, byte for byte.
//
// The question the board answers: the snapshot records no token for this
// protocol yet; if it launched one in line with the protocols in its own
// category whose tokens already trade, what would that token be worth?
//
//   implied value = TVL x peer multiple x momentum x maturity
//
// - peer multiple: the median market-cap/TVL ratio of the tokenised
//   protocols in the same category (only protocols the snapshot prices a
//   token for can teach us anything), shrunk toward the global median so a
//   category with two members cannot shout down one with forty. A single
//   peer's ratio is capped at 10x first: past that, the token's price is
//   plainly carried by something other than the protocol's TVL (one peer
//   in this snapshot prints 400x off a $6.6M TVL), and an uncapped median
//   would let one such print price an entire category.
// - momentum: the 7-day TVL change, clamped hard. The snapshot carries
//   wild prints (one protocol shows +4,448% in a week, the kind of jump a
//   coverage change makes); a launch priced off one week's noise would be
//   noise, so the factor stays inside [0.72, 1.50].
// - maturity: how long the protocol has run with no token recorded, from
//   listed_at to the snapshot's as_of day. Longer at scale reads as a more
//   credible launch, so the factor rises gently from 0.85 to 1.15 over
//   three years. A protocol with no listed_at gets the neutral 1.00.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface Peer {
  name: string;
  symbol: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  momentum: number;
  maturity: number;
  watchlist: boolean;
  peers: Peer[];
  farm_cost_usd: string;
  farm_weeks: string;
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  scanned: number;
  pre_token: number;
  live_size: number;
  early_size: number;
  global_multiple: number;
  model_note: string[];
  rows: RadarRow[];
}

/** Rows on the board: past the gate's 100 with room to show depth. */
export const BOARD_SIZE = 140;

// ------------------------------------------------------------ the universe

/** Records no token in the snapshot: neither a CoinGecko id nor a ticker. */
export const recordsNoToken = (p: Protocol): boolean => p.gecko_id === null && p.symbol === null;

// The watchlist's own exclusions, applied to the whole board: a wrapped,
// staked or bridged product of a token that already trades is not a launch
// that has not happened yet, at any size.
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isProductOfTraded(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

// ------------------------------------------------------------ statistics

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Median mcap/TVL per category over the protocols whose tokens trade, shrunk to the global median. */
function peerMultiples(protocols: Protocol[]): { byCategory: Map<string, number>; global: number; peersByCategory: Map<string, Peer[]> } {
  const ratios = new Map<string, number[]>();
  const peers = new Map<string, Peer[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = Math.min(p.mcap_usd / p.tvl_usd, 10);
    all.push(r);
    const key = p.category ?? '(uncategorised)';
    const arr = ratios.get(key) ?? [];
    arr.push(r);
    ratios.set(key, arr);
    const list = peers.get(key) ?? [];
    list.push({ name: p.name, symbol: p.symbol, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, multiple: round2(r) });
    peers.set(key, list);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, number>();
  for (const [key, arr] of ratios) {
    const SHRINK = 6;
    byCategory.set(key, (arr.length * median(arr) + SHRINK * global) / (arr.length + SHRINK));
  }
  for (const list of peers.values()) list.sort((a, b) => b.mcap_usd - a.mcap_usd);
  return { byCategory, global, peersByCategory: peers };
}

// ------------------------------------------------------------ the factors

function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const c = clamp(change7d, -80, 150);
  return round2(clamp(1 + 0.35 * (c / 100), 0.72, 1.5));
}

function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.round(ms / 86_400_000);
}

function maturityFactor(days: number | null): number {
  if (days === null) return 1;
  const years = days / 365.25;
  return round2(0.85 + 0.3 * (Math.min(years, 3) / 3));
}

// ------------------------------------------------------------ farm plans

// What one transaction roughly costs, by the chain it lands on. Ranges, in
// US dollars, of the kind a farmer budgets with; Ethereum mainnet is the
// expensive outlier and the L2s and Solana are near-free by comparison.
const CHAIN_GAS: Record<string, string> = {
  Ethereum: '$4-18',
  Solana: 'under $0.05',
  Base: '$0.05-0.60',
  Arbitrum: '$0.05-0.80',
  Optimism: '$0.05-0.60',
  Binance: '$0.10-0.50',
  Tron: '$0.50-2.00 in energy',
  Avalanche: '$0.10-0.80',
  Polygon: '$0.01-0.10',
  Mantle: '$0.05-0.50',
  Scroll: '$0.10-0.80',
  Linea: '$0.05-0.50',
};
const gasOf = (chain: string): string => CHAIN_GAS[chain] ?? '$0.20-2.00';

interface FarmPlan {
  steps: string[];
  cost: string;
  weeks: string;
}

type StepFn = (p: Protocol, chain: string, gas: string) => string;

const openStep: StepFn = (p, chain, gas) =>
  `Create a fresh wallet for ${p.name} and fund it on ${chain}: keep $300-$1,500 of working capital plus gas money (about ${gas} per transaction on ${chain}); 20 minutes to set up.`;
const trackStep: StepFn = (p) =>
  `Keep a simple log of every ${p.name} action with dates, amounts and transaction hashes, and re-check the official announcements channel weekly; 10 minutes a week, and it is your proof of early, consistent use if eligibility is ever snapshotted.`;

// One playbook per category: the concrete surfaces a farmer actually works.
// Every step names the protocol, a chain, a size, a cost and a duration, so
// the plan can be followed rather than admired.
const PLAYBOOKS: Record<string, StepFn[]> = {
  Lending: [
    openStep,
    (p, chain, gas) =>
      `Supply $1,000-$5,000 of USDC or ETH into ${p.name} on ${chain} as collateral (one deposit, about ${gas} in gas) and leave it supplied; a position younger than four weeks rarely counts for much.`,
    (p, chain, gas) =>
      `Borrow 30-40% against the position and re-supply the borrowed asset once, keeping the health factor above 2.0 at all times; two more transactions at about ${gas} each, then let the loop sit for 6-10 weeks.`,
    (p) =>
      `Repay and re-borrow a small amount every two weeks so the position shows continuing, human use of ${p.name} rather than a single parked deposit; about 15 minutes and a few dollars of gas per touch.`,
    trackStep,
  ],
  Dexs: [
    openStep,
    (p, chain, gas) =>
      `Make 3-5 real swaps a week on ${p.name} (${chain}), $100-$500 each in the deepest pairs, at about ${gas} per swap; steady weekly volume over 6-8 weeks reads as a genuine user, one huge day does not.`,
    (p, chain, gas) =>
      `Add $500-$2,000 of liquidity to a top-three pool on ${p.name} and hold the position at least four weeks, accepting impermanent loss as the cost of the position (about ${gas} to open and close).`,
    (p) =>
      `Use one extra surface of ${p.name} beyond swapping - a limit order, a cross-chain route or its aggregator - once a week for a month, so the wallet touches more than one product.`,
    trackStep,
  ],
  'Risk Curators': [
    openStep,
    (p, chain, gas) =>
      `Deposit $1,000-$4,000 of a stablecoin into a ${p.name}-curated vault on ${chain} (one deposit, about ${gas}); curated vaults are where this protocol's usage is counted, so the deposit is the position.`,
    (p) =>
      `Split a second, smaller deposit ($500-$1,500) into a different ${p.name} vault with a different strategy, and hold both for at least 8 weeks; diversification across vaults is what a real allocator looks like.`,
    (p, chain, gas) =>
      `Withdraw 10-20% and re-deposit it once midway through the season (two transactions, about ${gas} each) so the wallet shows active allocation rather than a single forgotten deposit.`,
    trackStep,
  ],
  'Onchain Capital Allocator': [
    openStep,
    (p, chain, gas) =>
      `Allocate $1,000-$5,000 through ${p.name} on ${chain} into its main vault or strategy (about ${gas} to enter); this protocol routes capital for a living, so routed volume is the signal that matters.`,
    (p) =>
      `Rebalance once after 3-4 weeks - move 20-30% of the position to a second ${p.name} strategy - and then hold for a further month; allocators that never move read as parked money.`,
    trackStep,
  ],
  RWA: [
    openStep,
    (p) =>
      `Complete ${p.name}'s onboarding or KYC if the product asks for it (30-60 minutes, no fee in most cases) and deposit $1,000-$5,000 into its flagship real-world-asset vault; RWA positions are sticky, so plan to hold a full quarter.`,
    (p) =>
      `Claim or compound the yield on schedule - usually monthly for ${p.name} - and keep the position untouched between claims; a 10-12 week hold with regular claims is the pattern of a genuine holder.`,
    trackStep,
  ],
  Derivatives: [
    openStep,
    (p, chain, gas) =>
      `Deposit $500-$2,000 of margin into ${p.name} on ${chain} and open small, hedged or delta-neutral positions; trade 2-3 sessions a week for 6 weeks at about ${gas} per transaction rather than gambling one large long.`,
    (p) =>
      `If ${p.name} runs a points or trading season, size to its published tiers and stop at the tier your capital reaches honestly; manufactured wash volume is the one pattern these programs screen for.`,
    trackStep,
  ],
  CDP: [
    openStep,
    (p, chain, gas) =>
      `Open a vault in ${p.name} on ${chain}: deposit $1,000-$4,000 of ETH or a liquid staking token as collateral and mint 30-40% of its value in the protocol's stablecoin (about ${gas} per transaction, two to open).`,
    (p) =>
      `Hold the mint for 6-10 weeks, topping up collateral whenever the ratio drifts toward the liquidation line; check the position weekly, 10 minutes, and never let it ride close to liquidation for the sake of a farm.`,
    trackStep,
  ],
  Yield: [
    openStep,
    (p, chain, gas) =>
      `Deposit $1,000-$4,000 into ${p.name}'s main vault on ${chain} (about ${gas} to enter) and hold at least 8 weeks; yield vaults reward duration, so an early exit wastes the whole position.`,
    (p) =>
      `Compound the yield back into the same ${p.name} vault every two weeks - a small transaction each time - so the balance and the wallet's activity both grow across the season.`,
    trackStep,
  ],
};

const GENERIC_PLAYBOOK: StepFn[] = [
  openStep,
  (p, chain, gas) =>
    `Use ${p.name}'s core product on ${chain} with $500-$3,000 of capital at least once a week for 6-8 weeks (about ${gas} per transaction); for a protocol with no token recorded, consistent real usage is the only signal that has ever mattered.`,
  (p) =>
    `Add a second surface of ${p.name} - a different vault, pair, market or chain it runs on - from week three, so the wallet reads as a user of the protocol and not of one button.`,
  trackStep,
];

function farmPlan(p: Protocol): FarmPlan {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasOf(chain);
  const steps = (PLAYBOOKS[p.category ?? ''] ?? GENERIC_PLAYBOOK).map((fn) => fn(p, chain, gas));
  const big = p.tvl_usd >= 500_000_000;
  return {
    steps,
    cost: big ? '$1,500-$6,000 capital, under $60 gas' : '$300-$2,000 capital, under $40 gas',
    weeks: '6-12 weeks',
  };
}

// ------------------------------------------------------------ the board

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot: protocols and watchlist must be arrays');
  return raw;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const { byCategory, global, peersByCategory } = peerMultiples(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);

  const scored = snapshot.protocols
    .filter((p) => recordsNoToken(p) && !isProductOfTraded(p))
    .map((p) => {
      const multiple = byCategory.get(p.category ?? '(uncategorised)') ?? global;
      const momentum = momentumFactor(p.change_7d);
      const days = ageDays(p.listed_at, snapshot.as_of);
      const maturity = maturityFactor(days);
      const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity));
      return { p, multiple, momentum, days, maturity, implied };
    })
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  // The watchlist is a floor: every one of its slugs makes the board, even
  // if that takes the board past BOARD_SIZE.
  const chosen = scored.slice(0, BOARD_SIZE);
  const chosenSlugs = new Set(chosen.map((s) => s.p.slug));
  for (const s of scored) {
    if (watchlist.has(s.p.slug) && !chosenSlugs.has(s.p.slug)) {
      chosen.push(s);
      chosenSlugs.add(s.p.slug);
    }
  }
  chosen.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  // Ranks 1..N with implied values strictly falling: a $1 nudge settles a
  // tie deterministically and is invisible at these magnitudes.
  let prev = Number.POSITIVE_INFINITY;
  const rows: RadarRow[] = chosen.map((s, i) => {
    const value = Math.min(s.implied, prev - 1);
    prev = value;
    const plan = farmPlan(s.p);
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: plan.steps,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.days,
      multiple: round2(s.multiple),
      momentum: s.momentum,
      maturity: s.maturity,
      watchlist: watchlist.has(s.p.slug),
      peers: (peersByCategory.get(s.p.category ?? '(uncategorised)') ?? []).slice(0, 5),
      farm_cost_usd: plan.cost,
      farm_weeks: plan.weeks,
    };
  });

  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));

  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    pre_token: snapshot.protocols.filter(recordsNoToken).length,
    live_size: snapshot.protocols.length - snapshot.protocols.filter(recordsNoToken).length,
    early_size: rows.length,
    global_multiple: round2(global),
    model_note: [
      'Implied value = TVL x peer multiple x momentum x maturity, all from the snapshot itself.',
      'Peer multiple: median market-cap/TVL of the tokenised protocols in the same category, shrunk toward the global median; each peer ratio is capped at 10x so one outlier cannot price a category.',
      'Momentum: the 7-day TVL change clamped to [-80%, +150%], worth a factor of 0.72 to 1.50.',
      'Maturity: years running with no token recorded, worth a factor of 0.85 to 1.15 over three years.',
      'The board lists protocols that record no token and are not a wrapped, staked or bridged product of one that trades.',
    ],
    rows,
  };
  return { board, radar };
}

/** The dashboard's data, written beside the page as data.js. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

// ------------------------------------------------------------ the gate

/** Why this board fails the gate, in plain words, or null when it passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const inSnapshot = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allEqual = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.slug.length < 1 || row.slug.length > 128 || /\s/.test(row.slug)) return `row ${i}: slug ${JSON.stringify(row.slug)} is not 1-128 characters without whitespace`;
    if (seen.has(row.slug)) return `row ${i}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!inSnapshot.has(row.slug)) return `row ${i}: slug ${row.slug} is not a protocol in the snapshot`;
    if (row.name.length === 0) return `row ${i}: name is empty`;
    if (row.rank !== i + 1) return `row ${i}: rank is ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) return `row ${i}: implied value ${row.implied_value_usd} is not a positive integer within the cap`;
    if (row.implied_value_usd > prev) return `row ${i}: implied value rises with rank`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allEqual = false;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i}: ${row.farm_steps.length} farm steps, outside 3-12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i}: a farm step is ${len} characters, outside 20-600`;
    }
  }
  if (allEqual) return 'every implied value is equal';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}
