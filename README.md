# flights

A TypeScript CLI over [SerpAPI's Google Flights engine](https://serpapi.com/google-flights-api).

Two commands:

- **`flights search`** — one faithful request; a flag for **every** documented API option.
- **`flights scan`** — search a trip meeting criteria (price, stops, open-jaw cities) across **several months**, under a credit budget.

Runs on Node's native TypeScript — no build step, zero runtime dependencies.

## Setup

Requires Node ≥ 23.6 (uses native `.ts` execution). Get a key at
[serpapi.com/manage-api-key](https://serpapi.com/manage-api-key) and export it:

```sh
export SERPAPI_API_KEY="your-key"   # reused by any SerpAPI-backed tool
```

(Or pass `--api-key` per call.) Then run directly, or link it:

```sh
node src/cli.ts search --from AUS --to LHR --depart 2026-09-10 --return 2026-09-20
npm link            # makes `flights` available on your PATH
flights help
```

Each **non-cached** request costs one SerpAPI search credit (results are cached ~1h, so
repeats are free). `scan` can issue many requests — see [Credits & budget](#credits--budget).

## `flights search`

One request, one credit. Every flag maps to a documented `google_flights` parameter;
run `flights help search` for the full list. Highlights:

```sh
# Round trip, nonstop, cheapest first
flights search --from AUS --to LHR --depart 2026-09-10 --return 2026-09-20 \
  --max-stops nonstop --sort price

# Fly into ANY of several nearby airports (comma = OR)
flights search --from AUS --to MXP,BGY,LIN --depart 2026-09-10 --return 2026-09-20

# Open jaw / multi-city: into Paris, home from Tokyo
flights search --type multi --leg AUS:CDG:2026-09-10 --leg NRT:AUS:2026-09-24

# Business class, 2 adults, exclude a connection, cap price, JSON out
flights search --from AUS --to NRT --depart 2026-09-10 --return 2026-09-24 \
  --class business --adults 2 --exclude-conns LAX --max-price 4000 --out json
```

Trip types: `--type round` (default), `oneway`, or `multi` (needs `--leg`). Filters,
airlines, times, passengers, emissions, tokens, localization, and advanced flags
(`--deep`, `--show-hidden`, `--no-cache`, …) are all exposed. The CLI validates the
documented interactions (e.g. `--return` only for round trips; `--include-airlines`
vs `--exclude-airlines` are mutually exclusive) before spending a credit.

`--out table` (default) prints a human summary; `--out json` / `--raw` prints the raw
SerpAPI response for scripting.

## `flights scan`

The Google Flights API has **no date-range search** — each request is a single date. `scan`
expands a window into `(outbound dates × trip lengths × open-jaw orientations)`, runs one
request per tuple under a budget, then post-filters and ranks.

### Open jaw across months (the motivating case)

> Fly to a country, in through one city and out through another, cheapest over a few months,
> ≤ 1 stop, under a price ceiling.

```sh
flights scan --home AUS --cities DUB,SNN --open-jaw \
  --months 2026-09..2026-11 --nights 10-14 --dow fri,sat \
  --max-stops 1 --max-price 900 --top 20 --dry-run
```

`--cities DUB,SNN --open-jaw` searches **both** orientations (in DUB / out SNN, and the
reverse) as multi-city itineraries, so you see whichever direction is cheaper. Drop
`--dry-run` to actually run it; add `--baseline` to also price the straight round trips for
comparison. For a fixed open jaw (always into A, out of B) use `--into A --outof B`.

### Options

- **Route:** `--home`, `--cities`, `--open-jaw`, `--into`/`--outof`, `--baseline`
- **Dates:** `--months YYYY-MM..YYYY-MM` or `--from-date`/`--to-date`; `--nights N|LO-HI`
  (omit for a one-way scan); `--dow fri,sat`; `--depart-times`
- **Server-side filters:** `--max-price`, `--max-stops`, `--class`,
  `--include-airlines`/`--exclude-airlines`, `--currency`, `--gl`, `--hl`
- **Post filters (client-side, what the API can't do):** `--exact-stops` (the API only does
  "N or fewer"), `--max-total-duration`, `--max-layover`
- **Run & output:** `--concurrency` (default 6), `--max-credits` (default 300), `--dry-run`,
  `--top N`, `--per-date`, `--sort price|duration|stops`, `--out table|json|csv`

Run `flights help scan` for the annotated list.

### Credits & budget

Scan cost is multiplicative: `outbound_dates × nights_values × orientations`. A casual
3-month open-jaw scan can be hundreds of requests, so:

- **Always `--dry-run` first** — it prints the exact request count and estimated credits and exits.
- `scan` **refuses** to run a plan larger than `--max-credits` (default 300); raise it
  deliberately or narrow the window (`--dow`, `--nights`, fewer months).
- Cache hits are free, so re-running the same grid costs nothing.

## Development

```sh
npm install       # dev deps only (typescript, @types/node)
npm run typecheck # tsc --noEmit
npm test          # node --test
```

No runtime dependencies — the CLI uses the built-in `fetch` and `node:util`.
