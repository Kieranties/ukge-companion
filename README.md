# UKGE Companion

A personal exhibitor guide for **UK Games Expo 2026** (29–31 May · NEC
Birmingham), ranked by how well each booth matches your
[BoardGameGeek](https://boardgamegeek.com/) collection.

Live: **https://kieranties.github.io/ukge-companion/**

## What it does

Cross-references your BGG collection's publishers against the UKGE
exhibitor list, then surfaces:

- **Top recommendations** — booths who publish games you actually play,
  ranked by a play-weighted score (each game's contribution is capped so
  one favourite doesn't dominate).
- **Discovery** — publishers at the show who make games sharing
  categories and mechanics with your most-played titles, even if you
  don't own anything of theirs yet.
- **Booth tools** — mark stands as visited and add notes per booth;
  everything is stored in your browser via `localStorage` (no server,
  no account).
- **Search** — one box filters across exhibitor names, game titles in
  your collection, publishers, categories, hall, and stand number.

## How it's built

`build_dashboard.py` is a single-file static site generator. It reads
the cached BGG collection JSON and the UKGE exhibitor HTML, matches
publishers to exhibitors with a normalised token-set Jaccard
(plus a small denylist of ambiguous single-word names), and writes
`index.html` + `sw.js`.

To rebuild after refreshing the source data:

```sh
python build_dashboard.py
```

## Data sources

- `kieranties_collection.json` — BGG collection with publishers,
  categories, mechanics, play counts, and BGG ratings. 116 games,
  averaging ~14 publishers each (scraped via BGG's internal
  `linkeditems` endpoint because the public XML API now requires a
  Bearer token).
- `ukge_raw.html` — saved copy of the UKGE 2026 exhibitor listing page,
  used by the parser. 868 exhibitors.

## Mobile + offline

- Responsive layout down to ~360px.
- A service worker caches the page so it keeps working on the NEC's
  flaky wifi. Visit once on wifi, then it'll load from cache on the
  show floor.
- Notes and visited markers persist on-device. Switching browsers /
  devices won't carry them over.

## Caveats

- BGG only credits a subset of distributors per game. Carcassonne has
  no exhibitor match here despite Asmodee distributing it in the UK,
  because Asmodee isn't credited on the BGG entry. The Asmodee UK
  booth is still surfaced (via other matched games).
- "Tangential booth" badge flags exhibitors whose UKGE categories
  don't include core board-game ones — e.g. Hobby Japan exhibits as
  their RPG arm even though they publish many of my boardgames in
  Japan. Their score is discounted 70% so they don't dominate the top.

## Building it for yourself

The script is hard-wired to my BGG username and the 2026 exhibitor
list. To adapt it:

1. Replace `kieranties_collection.json` with your collection data
   (scrape it via a logged-in browser session; the public XML API
   requires a Bearer token).
2. Replace `ukge_raw.html` with the latest exhibitor listing
   (`curl https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/`).
3. Re-run `python build_dashboard.py`.

## License

MIT — see [LICENSE](LICENSE).
