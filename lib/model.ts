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
//
// The constants are set from this snapshot's own distributions, and the
// model notes printed on the board recompute the evidence on every run:
// of the 128 tokenised peers, 7 print a raw ratio above the 10x cap (the
// largest is 400x) while the median is 0.22x, so the cap trims a thin top
// tail and cannot move the median; of 340 pre-token protocols with a
// 7-day print, only 3 fall outside the [-80%, +150%] clamp (the largest
// is +4,448%), so the clamp guards the tail and leaves ordinary moves
// untouched; and only about one pre-token protocol in ten has run for
// three years, which is why maturity tops out there instead of paying
// for age almost nobody has.

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
  peer_count: number;
  category_median: number;
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
function peerMultiples(protocols: Protocol[]): {
  byCategory: Map<string, number>;
  global: number;
  peersByCategory: Map<string, Peer[]>;
  medianByCategory: Map<string, number>;
  peerCount: number;
  aboveCap: number;
  maxRaw: number;
} {
  const ratios = new Map<string, number[]>();
  const peers = new Map<string, Peer[]>();
  const all: number[] = [];
  let aboveCap = 0;
  let maxRaw = 0;
  for (const p of protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const raw = p.mcap_usd / p.tvl_usd;
    if (raw > 10) aboveCap++;
    if (raw > maxRaw) maxRaw = raw;
    const r = Math.min(raw, 10);
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
  const medianByCategory = new Map<string, number>();
  for (const [key, arr] of ratios) {
    const SHRINK = 6;
    medianByCategory.set(key, median(arr));
    byCategory.set(key, (arr.length * median(arr) + SHRINK * global) / (arr.length + SHRINK));
  }
  for (const list of peers.values()) list.sort((a, b) => b.mcap_usd - a.mcap_usd);
  return { byCategory, global, peersByCategory: peers, medianByCategory, peerCount: all.length, aboveCap, maxRaw };
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
  Monad: '$0.01-0.10',
  'Hyperliquid L1': 'under $0.05',
  Bitcoin: '$1-6 in fees',
  Sui: '$0.01-0.10',
  Stellar: 'under $0.01',
  Sonic: '$0.01-0.10',
  Fantom: '$0.01-0.10',
  'zkSync Era': '$0.05-0.50',
  Aptos: '$0.01-0.10',
  Ripple: 'under $0.01',
  Plasma: 'under $0.05',
  Ink: '$0.05-0.50',
  Flare: '$0.01-0.10',
  Noble: 'under $0.05',
  Algorand: 'under $0.01',
  Provenance: '$0.01-0.10',
  'World Chain': '$0.05-0.50',
  Manta: '$0.05-0.50',
  XION: 'under $0.05',
  RSK: '$0.10-0.60',
  Mezo: '$0.10-1.00 in fees',
  'Robinhood Chain': '$0.05-0.50',
  Arc: '$0.05-0.50',
  Pharos: '$0.01-0.10',
  Bittensor: '$0.10-0.50',
  BSquared: '$0.10-1.00 in fees',
  'Reya Network': '$0.05-0.50',
  Tempo: '$0.05-0.50',
  Stable: '$0.05-0.50',
  RISE: '$0.01-0.10',
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

// Playbooks shared by sibling categories whose farming work is the same.
const STABLECOIN_STEPS: StepFn[] = [
  openStep,
  (p, chain, gas) =>
    `Mint or buy $1,000-$4,000 of ${p.name}'s stablecoin on ${chain} (about ${gas} per transaction) and hold it in the wallet; for a stablecoin protocol, sustained balances in real wallets are the usage that counts.`,
  (p) =>
    `Put $500-$2,000 of the stablecoin to work in a ${p.name} pool or a partner lending market and leave it for 8-10 weeks, so the holding shows up as circulating, productive supply rather than a mint-and-dump.`,
  (p) =>
    `Make a handful of ordinary transfers in the stablecoin across the season - small, real amounts between wallets you actually use - because transfer activity is part of what issuers measure when they look at holders.`,
  trackStep,
];
const BTC_STEPS: StepFn[] = [
  openStep,
  (p, chain, gas) =>
    `Bridge or wrap $1,000-$5,000 of BTC into ${p.name} on ${chain} (bridge fees plus about ${gas} on the destination chain) and hold the BTC-backed position; these protocols count durable BTC deposits, not churn.`,
  (p) =>
    `Supply the wrapped BTC into ${p.name}'s main vault or lending market and leave it supplied for a full quarter; BTC wrappers are sticky products, and a 10-12 week hold is the pattern of a genuine depositor.`,
  (p) =>
    `Add a second, smaller tranche ($300-$1,000) midway through the season rather than one day-one lump, so the deposit history shows continuing conviction; then leave both tranches untouched until the season ends.`,
  trackStep,
];
const PAYMENTS_STEPS: StepFn[] = [
  openStep,
  (p) =>
    `Open a ${p.name} account, complete its verification (about 30 minutes) and load $500-$2,000; payments products count funded, verified accounts far more than sign-ups that never move money.`,
  (p) =>
    `Use ${p.name} for real spending across 6-8 weeks - a few ordinary payments or card purchases a week in amounts you would spend anyway - so the account history reads as a customer, not a farm.`,
  (p) =>
    `Keep a working balance in the account between payments instead of draining it after each use; the average balance held across the season is a number payments teams actually look at.`,
  trackStep,
];

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
  'Basis Trading': [
    openStep,
    (p, chain, gas) =>
      `Deposit $1,000-$4,000 of stablecoin margin into ${p.name} on ${chain} (about ${gas} to enter) and open its flagship basis position - long the spot asset, short the matching perpetual - so the book earns the funding spread instead of betting on price.`,
    (p) =>
      `Check the position twice a week and keep the margin ratio comfortably above the liquidation line; basis trades die from neglected margin, not from the spread, and a 10-minute check is the whole maintenance cost.`,
    (p, chain, gas) =>
      `Roll or resize the position once after 4-5 weeks - close a quarter of it and re-open it (about ${gas} per transaction) - so the wallet shows an actively managed book across the season rather than one forgotten trade; hold 8-12 weeks in total.`,
    trackStep,
  ],
  'Prediction Market': [
    openStep,
    (p, chain, gas) =>
      `Trade real event markets on ${p.name} (${chain}) with $50-$300 per market, 2-3 markets a week at about ${gas} per trade; pick events you actually have a view on, because positions held to resolution are what a genuine user looks like.`,
    (p) =>
      `Place limit orders on both sides of one liquid market and leave them working for a week; providing liquidity, not just taking it, is the behaviour prediction markets reward when they review early users.`,
    (p) =>
      `Hold at least two positions all the way to settlement and claim the payouts; a wallet that only buys and dumps before resolution reads as noise, while one that settles reads as a participant.`,
    trackStep,
  ],
  'Yield Aggregator': [
    openStep,
    (p, chain, gas) =>
      `Deposit $1,000-$4,000 into ${p.name}'s main aggregator vault on ${chain} (about ${gas} to enter); the aggregator routes the capital onward, and routed capital that stays is the usage that counts.`,
    (p) =>
      `From week three, split a second tranche ($500-$1,500) into a different ${p.name} vault running a different strategy, and hold both vaults for at least 8 weeks in total.`,
    (p, chain, gas) =>
      `Compound harvested yield back into the same ${p.name} vaults every two weeks (one small transaction each, about ${gas}) so the balances and the activity record both grow across the season.`,
    trackStep,
  ],
  'Leveraged Farming': [
    openStep,
    (p, chain, gas) =>
      `Open a leveraged farm on ${p.name} (${chain}): supply $1,000-$3,000, borrow against it at no more than 2-3x effective leverage, and keep the health factor above 1.6 at all times (about ${gas} per transaction, three to open).`,
    (p, chain, gas) =>
      `Harvest and re-compound the farm rewards weekly - a few minutes and about ${gas} each time; leveraged farms reward active managers, and an untended position is a liquidation waiting for volatility.`,
    (p) =>
      `De-risk on a schedule, not on emotion: if the health factor drifts under 1.4, repay part of the borrow the same day; never add leverage to chase a falling reward rate, which is how these positions actually blow up.`,
    trackStep,
  ],
  Farm: [
    openStep,
    (p, chain, gas) =>
      `Provide $500-$2,500 of liquidity to a main ${p.name} farm pool on ${chain} and stake the LP position in the farm (about ${gas} per transaction); staked liquidity that stays is the position this protocol counts.`,
    (p, chain, gas) =>
      `Harvest the rewards on a weekly rhythm for 6-8 weeks and re-stake at least half of each harvest (about ${gas} per harvest), so the position and the activity record grow instead of being drained.`,
    trackStep,
  ],
  Chain: [
    openStep,
    (p, chain) =>
      `Bridge $300-$1,500 onto ${chain} through ${p.name}'s canonical route and keep a small balance of the native gas asset; a chain's earliest real users are the wallets that actually moved money onto it.`,
    (p, chain) =>
      `Transact on ${chain} every week for 8-12 weeks: swap on its main DEX, use one lending or staking app, and vary the amounts; steady weekly activity across several native apps is the pattern that matters.`,
    (p) =>
      `If ${p.name} runs a quests, points or early-user program, complete its published tasks in order and keep the completion records; do not split activity across sybil wallets, which these programs screen for.`,
    trackStep,
  ],
  'Stablecoin Wrapper': STABLECOIN_STEPS,
  'Dual-Token Stablecoin': STABLECOIN_STEPS,
  'Anchor BTC': BTC_STEPS,
  'Decentralized BTC': BTC_STEPS,
  Payments: PAYMENTS_STEPS,
  'Crypto Card Issuer': PAYMENTS_STEPS,
  Insurance: [
    openStep,
    (p, chain, gas) =>
      `Buy cover on ${p.name} for a position you genuinely hold elsewhere - $1,000-$4,000 of cover on a lending or staking position - and pay the premium for a full term (about ${gas} to buy on ${chain}); real cover on real exposure is the usage insurers count.`,
    (p) =>
      `Hold the cover to expiry without cancelling midway, then renew once for a second term; two consecutive terms of held cover is the pattern of an actual customer rather than a one-off click.`,
    (p, chain, gas) =>
      `If ${p.name} offers a risk-pool or staking side, stake a smaller amount ($300-$1,000) there for the same period (about ${gas} to stake), so the wallet appears on both sides of the market, underwriting as well as buying.`,
    trackStep,
  ],
  'Liquidity Manager': [
    openStep,
    (p, chain, gas) =>
      `Deposit $1,000-$4,000 into a ${p.name}-managed liquidity vault on ${chain} (about ${gas} to enter); managed vaults are where this protocol's usage is counted, so the deposit is the position.`,
    (p) =>
      `Let the manager rebalance the position for at least 8 weeks without withdrawing; these vaults report duration-weighted capital, and churning in and out erases the signal you are building.`,
    (p, chain, gas) =>
      `Add a second deposit of $500-$1,500 into a different ${p.name} vault midway through the season (about ${gas} to enter), so the wallet reads as an allocator comparing strategies rather than a single parked ticket.`,
    trackStep,
  ],
  Restaking: [
    openStep,
    (p, chain, gas) =>
      `Restake $1,000-$4,000 of a liquid staking token through ${p.name} on ${chain} (about ${gas} to deposit) and delegate to one of its established operators; restaked balance held over time is the metric these protocols publish.`,
    (p) =>
      `Hold the restaked position for a full quarter without undelegating; restaking withdrawals are slow by design, and duration is exactly what separates a restaker from a tourist.`,
    (p, chain, gas) =>
      `If ${p.name} supports more than one network or service, split a smaller second tranche ($300-$1,000) across a second one from week four (about ${gas} to deposit), so the wallet shows deliberate allocation.`,
    trackStep,
  ],
  'Staking Pool': [
    openStep,
    (p, chain, gas) =>
      `Stake $500-$3,000 of the native asset through ${p.name}'s pool on ${chain} (about ${gas} to stake) and leave it staked; pooled staking counts stake that stays, so plan on a full quarter.`,
    (p, chain, gas) =>
      `Compound the staking rewards back into the pool every two to three weeks (one small transaction each, about ${gas}), so both the balance and the activity record grow across the season.`,
    trackStep,
  ],
  'Governance Incentives': [
    openStep,
    (p, chain, gas) =>
      `Hold or stake $500-$2,500 of ${p.name}'s governance-eligible asset on ${chain} for the whole season (about ${gas} to stake); these programs reward wallets that were present and eligible when votes happened.`,
    (p, chain, gas) =>
      `Vote on every ${p.name} proposal that comes up while you hold - usually a few minutes and about ${gas} each - and keep a record of the votes; a holder who never votes is indistinguishable from a parked wallet.`,
    trackStep,
  ],
  'OTC Marketplace': [
    openStep,
    (p, chain, gas) =>
      `Complete ${p.name}'s onboarding and make a first small trade ($200-$1,000) on ${chain} at about ${gas} per transaction; on an OTC venue, the first settled trade is what turns a sign-up into a user.`,
    (p) =>
      `Trade two or three more times across 6-8 weeks in similar sizes, on both sides of the market if the venue allows it; a short history of settled, ordinary trades is the reputation these marketplaces are built on.`,
    trackStep,
  ],
  'Collateral Markets': [
    openStep,
    (p, chain, gas) =>
      `Supply $1,000-$4,000 of collateral into ${p.name} on ${chain} (about ${gas} to deposit) and borrow 25-35% against it once, keeping the health factor above 2.0; collateral markets count supplied-and-borrowed positions, not deposits alone.`,
    (p) =>
      `Service the position every two weeks - repay a slice and re-borrow, or top up collateral - for 8-10 weeks, so the account shows a managed credit line rather than a single parked loan.`,
    trackStep,
  ],
  'CDP Manager': [
    openStep,
    (p, chain, gas) =>
      `Deposit $1,000-$4,000 of collateral into a ${p.name}-managed CDP vault on ${chain} (about ${gas} to enter) and let it mint at the manager's target ratio; the managed position, held, is the usage signal here.`,
    (p) =>
      `Check the vault weekly (10 minutes) and top up collateral if the manager's alerts ask for it; hold 8-10 weeks, because CDP managers report duration-weighted collateral, not deposits that left.`,
    trackStep,
  ],
  CeDeFi: [
    openStep,
    (p, chain, gas) =>
      `Deposit $1,000-$4,000 into ${p.name}'s main CeDeFi product on ${chain} (about ${gas} to enter) and select a fixed term if one is offered; term deposits held to maturity are the usage these products are built on.`,
    (p) =>
      `At the first maturity or renewal point, roll at least half the position into a new term instead of withdrawing everything; a renewal is the clearest signal of a genuine customer these products ever see.`,
    trackStep,
  ],
  'Cross Chain Bridge': [
    openStep,
    (p, chain, gas) =>
      `Bridge real transfers through ${p.name} - $200-$1,000 at a time, two or three routes a month at about ${gas} per hop - moving funds you actually need on the destination chain; volume from wallets that stay active on both sides is what counts.`,
    (p) =>
      `Use at least two different destination chains across the season and keep small working balances on each, so the wallet reads as a genuine multi-chain user rather than a one-off test transfer.`,
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

// How long a season runs, by what the work actually is: RWA, insurance
// and restaking positions are quarterly by nature, prediction markets
// settle in weeks, and the rest sit between.
const SEASONS: Record<string, string> = {
  Lending: '6-10 weeks',
  Dexs: '6-8 weeks',
  'Risk Curators': '8-10 weeks',
  'Onchain Capital Allocator': '8-10 weeks',
  RWA: '10-12 weeks',
  Derivatives: '6-8 weeks',
  CDP: '6-10 weeks',
  Yield: '8-10 weeks',
  'Basis Trading': '8-12 weeks',
  'Prediction Market': '4-8 weeks',
  'Yield Aggregator': '8-10 weeks',
  'Leveraged Farming': '6-8 weeks',
  Farm: '6-8 weeks',
  Chain: '8-12 weeks',
  Insurance: '10-12 weeks',
  Restaking: '10-12 weeks',
  'Staking Pool': '10-12 weeks',
  'Collateral Markets': '8-10 weeks',
  'CDP Manager': '8-10 weeks',
};

/** Budget by protocol size and by the primary chain's fee level. */
function farmCost(p: Protocol, chain: string): string {
  const dear = chain === 'Ethereum' || chain === 'Bitcoin';
  if (p.tvl_usd >= 500_000_000) return dear ? '$1,500-$6,000 capital, under $150 gas' : '$1,500-$6,000 capital, under $60 gas';
  if (p.tvl_usd >= 100_000_000) return dear ? '$800-$3,500 capital, under $120 gas' : '$800-$3,500 capital, under $50 gas';
  return dear ? '$300-$2,000 capital, under $100 gas' : '$300-$2,000 capital, under $40 gas';
}

function farmPlan(p: Protocol): FarmPlan {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasOf(chain);
  const steps = (PLAYBOOKS[p.category ?? ''] ?? GENERIC_PLAYBOOK).map((fn) => fn(p, chain, gas));
  return {
    steps,
    cost: farmCost(p, chain),
    weeks: SEASONS[p.category ?? ''] ?? '6-10 weeks',
  };
}

// ------------------------------------------------------------ the board

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot: protocols and watchlist must be arrays');
  return raw;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const { byCategory, global, peersByCategory, medianByCategory, peerCount, aboveCap, maxRaw } = peerMultiples(snapshot.protocols);
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
      peer_count: (peersByCategory.get(s.p.category ?? '(uncategorised)') ?? []).length,
      category_median: round2(medianByCategory.get(s.p.category ?? '(uncategorised)') ?? global),
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

  // The evidence behind the model's constants, recomputed from this
  // snapshot on every run so the notes can never drift from the data.
  const preToken = snapshot.protocols.filter(recordsNoToken);
  const changes = preToken.map((p) => p.change_7d).filter((x): x is number => x !== null);
  const outsideClamp = changes.filter((x) => x < -80 || x > 150).length;
  const maxChange = changes.length > 0 ? Math.max(...changes) : 0;
  const ages = preToken.map((p) => ageDays(p.listed_at, snapshot.as_of)).filter((x): x is number => x !== null);
  const medianAge = ages.length > 0 ? median(ages) : 0;
  const share3y = ages.length > 0 ? Math.round((ages.filter((d) => d >= 3 * 365.25).length / ages.length) * 100) : 0;

  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    pre_token: preToken.length,
    live_size: snapshot.protocols.length - preToken.length,
    early_size: rows.length,
    global_multiple: round2(global),
    model_note: [
      'Implied value = TVL x peer multiple x momentum x maturity, all from the snapshot itself.',
      `Peer multiple: median market-cap/TVL of the tokenised protocols in the same category, shrunk toward the global median; each peer ratio is capped at 10x. In this snapshot ${aboveCap} of ${peerCount} priced peers print above 10x (the largest is ${Math.round(maxRaw)}x) against a global median of ${round2(global)}x, so the cap trims a thin top tail and cannot move the median.`,
      `Momentum: the 7-day TVL change clamped to [-80%, +150%], worth a factor of 0.72 to 1.50. Only ${outsideClamp} of ${changes.length} pre-token protocols print outside that band here (the largest is +${Math.round(maxChange)}%), so the clamp guards the tail and leaves ordinary moves untouched.`,
      `Maturity: years running with no token recorded, worth a factor of 0.85 to 1.15 over three years. The median pre-token protocol here has run ${Math.round(medianAge)} days and only ${share3y}% have passed three years, which is why the factor tops out there.`,
      'The board lists protocols that record no token and are not a wrapped, staked or bridged product of one that trades.',
      'Every row states how many trading peers stand behind its multiple; a row with none is priced off the global median alone and says so in its detail view.',
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
