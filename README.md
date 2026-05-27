# UKGE Companion

A personal exhibitor guide for **UK Games Expo 2026** (29–31 May · NEC
Birmingham), ranked by how well each booth matches your
[BoardGameGeek](https://boardgamegeek.com/) collection.

Live: **https://blog.kieranties.com/ukge-companion/**

## Architecture

```
data-pipeline/    Python — fetches/parses BGG + UKGE data
  build_data.py   → writes web/src/data/dashboard.json
  *.json,*.html   cached input data

web/              Astro static site
  src/
    pages/        index.astro
    components/   *.astro — ExhibitorCard, HotCard, …
    scripts/      *.ts    — state, search, filters, tabs, …
    styles/       global.css
    data/dashboard.json  ← from pipeline (gitignored)
  public/         manifest.json, sw.js, icon.svg, icon-maskable.svg

.github/workflows/deploy.yml   builds + deploys to GitHub Pages
```

## Features

- **Top recommendations** — booths who publish games you actually play,
  ranked by play-weighted publisher matches.
- **Games to look out for** — BGG's hot list filtered to games whose
  publishers exhibit at UKGE.
- **Discovery** — publishers whose game tags match your taste but who don't
  publish anything you own yet.
- **Route plan** — matched stands grouped by hall + stand order, with
  per-hall progress counters.
- **Browse all 868 exhibitors** — the whole show.
- **Per-booth tools** — visited (cycle through unvisited → visited →
  visit-again), buy 🛒, skip, day assignment (Fri/Sat/Sun), notes.
  Everything stored locally in `localStorage`.
- **Real search** — MiniSearch inverted index across exhibitors, games,
  publishers, awards. Prefix + fuzzy match, weighted by field.
- **Friend share** — encode your plan to a base64 URL fragment; receiving
  side gets a merge-or-replace prompt.
- **Markdown export** — copy your plan into Obsidian/Slack/wherever.
- **Game-of-the-year badges** — Spiel des Jahres, Kennerspiel, Golden Geek
  winners and nominees overlaid on relevant games.
- **PWA** — installable, works offline via service worker.
- **Light + dark themes** — toggle in the header; defaults to system
  preference.

## Local development

Prereqs: Python 3.12+, Node 22+.

```sh
# 1) build the data
cd data-pipeline
python build_data.py

# 2) run Astro
cd ../web
npm install
npm run dev          # http://127.0.0.1:4321/ukge-companion/
npm run build        # production output → web/dist/
npm run preview      # preview the built output
```

Deployment is automatic via `.github/workflows/deploy.yml` on push to
`main`. GitHub Pages source must be set to **GitHub Actions** in the repo
settings.

## Refreshing the source data

The cached BGG + UKGE files live in `data-pipeline/`. To refresh:

- `data-pipeline/kieranties_collection.json` — your BGG collection. BGG's
  XML API now requires a Bearer token; current data was scraped via a
  logged-in browser session.
- `data-pipeline/ukge_raw.html` — `curl https://www.ukgamesexpo.co.uk/whats-on/show/exhibitors/`.
- `data-pipeline/bgg_hotness.json` — same scraping flow as the collection,
  hitting `boardgamegeek.com/hotness` and the `geekitem/linkeditems`
  endpoint per game.
- `data-pipeline/awards.json` — hand-curated; edit directly to add new
  awards. See the `_doc` field at the top.

## License

MIT — see [LICENSE](LICENSE).
