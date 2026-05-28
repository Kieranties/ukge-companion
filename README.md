# UKGE Companion

A personal exhibitor guide for **UK Games Expo 2026** (29–31 May · NEC
Birmingham), ranked by how well each booth matches your
[BoardGameGeek](https://boardgamegeek.com/) collection.

Live: **https://blog.kieranties.com/ukge-companion/**

Releases: see the [GitHub releases page](https://github.com/Kieranties/ukge-companion/releases)
for notes on every tagged version.

## Architecture

```
data-pipeline/                Python — fetches/parses BGG + UKGE data
  build_data.py               → writes web/src/data/dashboard.json
  scrape_exhibitor_games.py   per-vendor scraper → exhibitor_games.json
  *.json, *.html              cached inputs (collection, hotness, awards, …)

web/                          Astro static site
  src/
    pages/index.astro         all sections live here (single-page app)
    components/               *.astro — ExhibitorCard, HotCard, DiscoveryCard,
                              AllVendorCard, BoothTools, Logo, AwardBadge,
                              UkgeGames
    scripts/                  *.ts — module per concern (see below)
    styles/global.css         single stylesheet, themed via [data-theme]
    data/dashboard.json       ← from pipeline (gitignored)
  public/                     manifest.json, sw.js, icons, share-card.png

.github/workflows/deploy.yml  Python build → Astro build → GitHub Pages
```

### Script modules

Each `.ts` owns one slice of behavior. `main.ts` wires them together.

| Module           | Owns                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `state.ts`       | localStorage-backed per-booth state (visit, buy list, day, notes)     |
| `cards.ts`       | Booth-tool button wiring via document-level event delegation          |
| `tags.ts`        | Multi-facet filter state (AND across, OR within) + active-chip strip  |
| `filters.ts`     | Status / day / show-hidden pill toggles + visibility application      |
| `filters-panel.ts` | Facet browser (sheet on mobile, popover on desktop) with live counts |
| `filter-tray.ts` | Collapse/expand of the filter tray, count badge                       |
| `search.ts`      | MiniSearch index built from card data attributes; results panel       |
| `tabs.ts`        | Tab routing, hash-aware                                               |
| `route.ts`       | Route-plan rendering by day                                           |
| `shopping.ts`    | Shopping tab: per-vendor checkable buy list                           |
| `export.ts`      | Markdown plan export modal                                            |
| `share.ts`       | Base64 URL-fragment encode/decode + merge-on-import prompt            |
| `theme.ts`       | Theme toggle (paint-blocking init lives inline in `index.astro`)      |
| `header-menu.ts` | Mobile kebab popover that collects header actions                     |
| `pwa.ts`         | Service worker + install prompt                                       |

## Features

### Recommendations
- **Top recommendations** — booths publishing games you've played, ranked by:
  - play-weighted matches (capped at 25 plays per game so favourites don't
    drown the rest)
  - publisher rarity dampener so big generic publishers stop dominating
  - category affinity bonus blending your top genres
- **Games to look out for** — BGG's hot list filtered to games whose
  publishers exhibit at UKGE
- **Discovery** — publishers whose game tags match your taste but who don't
  publish anything you own yet
- **Why?** panel on each vendor card breaks the score into its parts

### Planning
- **Route plan** — booths grouped by day, hall, and stand order
- **Shopping tab** — checkable buy list per vendor, exports with checkboxes
- **Booth tools** per card — `+ Add to plan` (cycle through Any/Fri/Sat/Sun),
  `Mark as visited` (visited → revisit ★ → off), `Buy 🛒`, `Hide`, `Notes`
- All state lives in `localStorage`. Friend share encodes it to a base64
  URL fragment; receiver gets a merge-or-replace prompt
- **Markdown export** of full plan (visited, revisit, shopping list, day
  plans, notes, hidden) — copy into Obsidian/Slack/wherever

### Search & filters
- **Real text search** — MiniSearch inverted index across exhibitors, games,
  publishers, awards, halls. Prefix + fuzzy match, weighted by field
- **Combinable filters** — AND across facets, OR within. Chips show every
  active filter; click any chip to remove
- **Filters panel** browses every facet (Category / Publisher / Hall) with
  live counts that reflect what's reachable under your current filters
- **Tag clicks on cards** are additive — click "Fantasy" then "Co-op" to
  combine genres without losing the first selection

### Browse all
- All 868 exhibitors searchable and filterable

### Polish
- **PWA** — installable, offline-capable via service worker
- **Light + dark themes** — system-preference default, paint-blocking init
  to avoid flash on load
- **Game-of-the-year badges** — Spiel des Jahres, Kennerspiel, Golden Geek
  winners + nominees overlaid where relevant
- **Mobile-first** — collapsible filter tray, header collapses to a kebab
  menu, booth tools laid out as a predictable 6-column grid
- **Info tab** — embedded map, opening times (Trade Hall + Gaming +
  Library), and your **taste signal** (collection stats + top categories
  and mechanics weighted by plays)

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
- `data-pipeline/exhibitor_games.json` — produced by `scrape_exhibitor_games.py`;
  concurrent fetch over ~868 vendor pages.
- `data-pipeline/bgg_hotness.json` — same scraping flow as the collection,
  hitting `boardgamegeek.com/hotness` and the `geekitem/linkeditems`
  endpoint per game.
- `data-pipeline/hot_descriptions.json` — descriptions for hot games,
  cached alongside the hotness fetch.
- `data-pipeline/awards.json` — hand-curated; edit directly to add new
  awards. See the `_doc` field at the top.

## License

MIT — see [LICENSE](LICENSE).
