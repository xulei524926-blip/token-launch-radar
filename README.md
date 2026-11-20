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
