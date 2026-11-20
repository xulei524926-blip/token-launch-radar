# Token Launch Radar

A radar for the token launches that have not happened yet. It reads the
sealed DefiLlama snapshot (758 protocols, 2026-11-14), works out which
protocols record no token and are not a wrapped, staked or bridged product
of one that already trades, and ranks 140 of them by the value a launch
would imply - with a concrete farm plan for every row.

## The model

Implied value = TVL x peer multiple x momentum x maturity, every input
from the snapshot itself:

- **Peer multiple** - the median market-cap/TVL of the tokenised protocols
  in the same category, shrunk toward the global median (0.21x) so small
  categories cannot shout; each peer ratio is capped at 10x so one outlier
  cannot price a category.
- **Momentum** - the 7-day TVL change, clamped to [-80%, +150%], worth a
  factor of 0.72 to 1.50.
- **Maturity** - years running with no token recorded, worth 0.85 to 1.15
  over three years.

The constants come from the snapshot's own distributions, and the model
notes on the dashboard recompute the evidence on every run: 7 of the 128
priced peers print above the 10x cap (the largest is 400x) against a
0.21x median, so the cap trims a thin top tail without moving the
median; only 3 of 340 pre-token protocols print outside the momentum
clamp (the largest is +4,448%), so the clamp guards the tail and leaves
ordinary moves untouched; and the median pre-token protocol has run 513
days with only 11% past three years, which is why maturity tops out
there.

Every row states how many trading peers stand behind its multiple - a
row priced off the global median alone says so - and every one of the
30 categories on the board has its own farm playbook, with the budget
scaled to the protocol's TVL tier and primary chain, and the season
matched to the work: 4-8 weeks for prediction markets, 10-12 for RWA,
insurance and restaking.

One honest consequence of the data: the top of the board is heavy with
Risk Curators, because that is where the snapshot's largest pre-token
TVLs sit. The category has exactly one priced peer in the snapshot
(Api3, at 2.97x), and shrinkage pulls that to the 0.61x actually used -
each affected row shows the single peer and the shrinkage path in its
detail view rather than hiding behind the number.

The dashboard states the model on the page and shows the arithmetic, the
trading peers behind every multiple, and the farm plan (budget and season
included) for each protocol.

## Run it

Node 22, standard library only, no network:

```
node main.ts --input <snapshot.json> --output <dir>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` (built with `vendor/makefun-board.ts`) into the output
directory. Deterministic: the same snapshot yields the same bytes.

## Layout

- `main.ts` - entry point: snapshot in, board, dashboard and dossier out.
- `lib/model.ts` - the model: universe rules, peer multiples, farm plans,
  and a self-check of the board against the gate's shape.
- `dashboard/` - the static page: sortable, filterable board, a detail
  view per protocol, no network.
- `screenshots/` - the board, one protocol's detail view, a filtered view.
- `vendor/makefun-board.ts` - make.fun's dossier library, vendored as
  required, byte for byte.

MIT licensed.
