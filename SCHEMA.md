# Reel schema

A reel is one JSON file, `reels/<topic>/sr-000123.json`, that the app plays as a 15–20 second pixel-art scene with narration. `<topic>` is the domain of its first source article. The job writes only the **input fields**; `scripts/generate.py add` fills in the rest.

## Input (what you write)

```json
{"reels": [{
  "title": "Query one hundred and one",
  "style": "humor",
  "backdrop": "office",
  "sources": ["articles/platform-architecture/governor-limits.md"],
  "beats": [
    {"say": "Dex writes a query inside a loop. Bold move.",
     "actors": [{"id": "dex", "x": 35, "anim": "nod"}],
     "props": [{"id": "desk", "x": 68, "scale": 4}, {"id": "computer", "x": 68, "y": 54}],
     "sfx": "blip"},
    {"say": "Synchronous Apex gets one hundred SOQL queries per transaction. Not one more.",
     "speaker": "gus",
     "actors": [{"id": "dex", "x": 30, "anim": "sulk"}, {"id": "gus", "x": 70, "flip": true}],
     "sign": "SOQL: 100", "fx": "alarm", "sfx": "error"}
  ],
  "facts": [
    {"claim": "Synchronous Apex is limited to 100 SOQL queries per transaction.",
     "source": "articles/platform-architecture/governor-limits.md",
     "evidence": "SOQL queries: 100 / 200"}
  ]
}]}
```

| Field | Rules |
| --- | --- |
| `title` | 8–70 characters, unique. Internal name; never shown. |
| `style` | `fact` (surprising fact), `story` (mini story), `humor` (joke or analogy), `myth` (myth busting). |
| `myth` | Myth reels only: the false belief, 10–160 characters. |
| `backdrop` | An id from `library/backdrops.json`. |
| `sources` | 1–3 article paths in the knowledge graph. The first is the primary one: it names the folder and the corner label. |
| `beats` | 3–7. Together the narration must run **15–20 seconds** (about 38–50 words). |
| `facts` | 1–4. One per factual claim the narration makes. |

### Beat

| Field | Rules |
| --- | --- |
| `say` | The narration and caption: 2–26 words, at most 170 characters, no URLs. Write numbers the way they should be spoken ("one hundred", not "100") unless the digit reads better on screen; the narrator reads this text aloud. |
| `speaker` | Optional cast id. That character's mouth moves. There is one narrator voice, so make clear in the words who is talking. Must be on screen. |
| `actors` | Up to 3: `{"id", "x", "anim", "emote", "flip", "scale"}`. `x` is 0–100 across the screen (default 50). `flip: true` faces left. |
| `props` | Up to 4: `{"id", "x", "y", "scale", "anim", "flip"}`. Leave `y` out to stand the prop on the ground; otherwise 0–100 down the screen. `scale` 1–8 (default 3). |
| `sign` | Optional on-screen pixel sign, 1–18 characters, e.g. `"SOQL: 100"`. Digits belong here. |
| `fx` | `none shake flash confetti rain sparkle alarm dark snow` |
| `sfx` | `none blip coin jump error powerup rimshot fanfare whoosh boing zap` |

Every beat needs at least one actor or prop.

- Actor `anim`: `idle talk enter-left enter-right exit-left exit-right jump shake cheer spin sulk run float faint nod`
- Actor `emote`: `! ? ... heart idea sweat anger zzz star`
- Prop `anim`: `none bob spin drop pulse fly-left fly-right grow shake rise`

These lists live in `app/engine.js`; the checks read them from there.

### Fact

`claim` says what the reel asserts (10–220 characters). `source` is one of the reel's source paths. `evidence` is a **4–15 word phrase copied word for word from that article** (its body or summary). The fact check fails if the phrase is not there, so a reel can only state what its article states.

### Myth reels

The beat that states the myth carries a `sign` starting `MYTH`, and a later beat carries a `sign` containing `FACT` or `BUSTED`. The false claim is never left standing, and `facts` covers the true version.

## Stamped by the scripts

`id`, `topics` (the sources' domains, used by the feed), `cast` (who appears), `sources` (path, id, title, domain, release, blob hash), `source_commit`, `verified_release`, `created`, `status` (`active`, `stale`, `superseded`, `retired`), and `supersedes` / `superseded_by` / `retired_reason` / `verified`.

## Library

The pixel art lives in three files the job may extend. The render test draws every item, so a broken sprite fails validation.

**`library/cast.json`** — characters are drawn from a spec, not a bitmap:

```json
{"id": "ada", "name": "Ada", "role": "Salesforce admin", "personality": "…", "gags": ["…"],
 "kind": "human", "hair": "bun", "hairColor": "#2b1d16", "skin": "#c98d62",
 "shirt": "#3b82c4", "pants": "#2d3550", "accessories": ["mug"]}
```

- `kind`: `human` or `robot` (robots take `body`, `eye`, `trim` colours instead).
- `hair`: `short long bun spiky bald curly ponytail`
- `accessories`: `glasses headset tie cap whistle mug cape badge bowtie scarf hardhat crown` (optional colours: `tie`, `scarf`, `hat`, `cape`)

**`library/props.json`** — small sprites as rows of characters, `.` is transparent, each other character is a colour in `palette`. 3–24 rows and columns, at most 12 colours, all rows the same width.

**`library/backdrops.json`** — a `ground` y position (190–250; characters stand on it, 232 is standard) and `layers` drawn in order on a 180×320 canvas: `rect grad checker stripes bricks stars hills prop window sun skyline`. Layers that touch the top or bottom edge stretch on tall phones, so start the sky at `y: 0` and run the floor to `y + h = 320`.
