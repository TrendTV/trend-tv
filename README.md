# Trend TV

A tiny CRT-TV desktop companion that lives in the corner of your screen and
types out trending GitHub repos — like watching a retro terminal channel
while you vibe code.

![preview](shot1.png)

## Features (v0.1)

- **Old-TV typing display** — repo name, channel/category, description typed
  character-by-character on a phosphor CRT with scanlines, chromatic glow,
  and flicker. Holds 5 s after typing so you can read it, then glitches to
  the next card.
- **Channels** — hover the ⚙ gear (top-right) to open the TV Guide and switch
  channels: ALL / Production / Visual / Audio / DevTools / Games, with a
  static-burst channel-change animation. Categories are keyword-classified
  from each repo's language and description.
- **TV appearances** — Green CRT, Amber, VHS Blue, B&W 1950s themes.
- **Click a card** to open the repo on GitHub.
- **Resilient feed** — the Rust backend scrapes `github.com/trending`
  (daily + weekly, merged & deduped) every 3 h into a local JSON cache.
  The display never depends on a live fetch: on failure it keeps serving
  the cache; if the signal has been lost for >24 h the app shows a
  "PLEASE STAND BY" test card while playing reruns from cache. A bundled
  snapshot means even a first offline launch has content.
- **No-repeat shuffle** — each channel plays through a shuffled bag before
  reshuffling, with a 200-item seen-history so fresh repos come first.

## Run it

```sh
npm install

# browser preview (uses bundled snapshot data)
npm run dev

# desktop app (dev mode, connects to the dev server)
npm run tauri dev

# production build (installer in src-tauri/target/release/bundle)
npm run tauri build
```

## Stack

Tauri v2 (Rust backend: reqwest + scraper fetcher, local JSON cache) +
vanilla JS/CSS frontend (Vite). No server, no API keys, no tracking.

## Roadmap (Steam "deluxe" tier ideas)

Theme/skin packs, CRT sound pack, more feeds (Hacker News, Product Hunt),
Steam Workshop themes, achievements, auto-updates.
