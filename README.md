# Salesforce Reels

Bite-sized, 16-bit pixel-art reels that make Salesforce knowledge stick: **https://john1hsu.github.io/salesforce-reels/**

Each reel is a 15–20 second scene with a setup and a punchline: a surprising fact, a mini story, a joke or analogy, or a busted myth. Everything a reel claims comes from a cited article in [salesforce-knowledge-graph](https://github.com/john1hsu/salesforce-knowledge-graph). It is the entertaining sibling of [salesforce-quiz-bank](https://github.com/john1hsu/salesforce-quiz-bank).

## Watching

- **Swipe up** for the next reel, **swipe down** to go back. A reel loops until you swipe.
- **Tap** to turn the narrator on or off. It starts muted, because browsers only allow speech after a tap. Captions light up word by word either way.
- **Tap the corner label** to open the source article.

On a computer: arrow keys or the scroll wheel to move, space to toggle sound.

## The cast

| | Role | Running gag |
| --- | --- | --- |
| **Ada** | Admin | Fixes it with clicks while everyone else panics. Never puts down her mug. |
| **Dex** | Developer | Writes code when a checkbox would do, and learns limits the hard way. |
| **Archie** | Architect | "It depends." Produces a whiteboard out of nowhere. |
| **Penny** | Business stakeholder | Needs it by Friday. It's "just a quick one". |
| **Bolt** | AI agent | Takes every instruction completely literally. |
| **Gus** | The Governor | Blows the whistle the instant a limit is crossed. |

The cast, props and backdrops are original and live in `library/`. The daily job adds to them over time.

## How the feed picks the next reel

There is no account and no server: what the feed learns stays in your browser's storage on that device.

1. When a reel leaves the screen, its **watch ratio** is recorded: time watched ÷ the reel's length. A reel left looping counts up to 3; a quick swipe counts near 0. Opening the source article adds 1.
2. That ratio updates a running score for the reel's **topics** (the knowledge graph's domains), its **style**, and each **character** in it. Each score moves 30% of the way toward the new ratio, so recent viewing counts most. Every score starts at 1.
3. The next reel is drawn from the ones you **haven't seen**. One pick in five is completely random, so new topics keep surfacing. The rest are weighted by the average of the reel's topic, style and character scores.
4. A score never drops a reel's weight below a small floor: topics you skip fade, but never vanish.
5. Once you have seen everything, the same weighted draw replays old reels, skipping the last ten.

The settings are at the top of `app/app.js`.

## How reels are made

A scheduled job runs once a day and follows `CLAUDE.md`: it refreshes any reel whose source article changed, then writes about 20 new reels from the articles with the fewest reels, and pushes one combined commit. Reels are JSON scripts (`SCHEMA.md`), not video files; the app draws them live on a canvas, the narrator is the browser's own speech voice, and the sound effects are synthesized, so the repo stays small.

Every reel passes four checks before it is committed (`python3 scripts/validate.py --source <graph clone>`):

1. **Fact check**: each fact quotes a phrase that appears word for word in its source article.
2. **Duplicate check**: no repeated title, near-identical narration, or same fact told in the same style.
3. **Length check**: the narration fits 15–20 seconds.
4. **Render test**: the engine plays every beat of every reel without an error.

## Layout

```
app/        the player: engine.js (drawing and timing), app.js (feed, gestures, sound)
library/    cast.json, props.json, backdrops.json
reels/      one JSON script per reel, by topic
index/      manifest.json, the list the app loads (generated)
coverage/   coverage.json, reels per article, style and character (generated)
scripts/    generate.py, refresh.py, validate.py, build_index.py, render_test.js
```

Preview locally:

```bash
mkdir -p _site && cp -r app/. _site/ && cp index/manifest.json _site/ && cp -r reels library _site/
python3 -m http.server -d _site 8000
```
