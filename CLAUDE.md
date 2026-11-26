# Salesforce Reels: daily run playbook

This repo holds short pixel-art reels generated from [john1hsu/salesforce-knowledge-graph](https://github.com/john1hsu/salesforce-knowledge-graph). A daily scheduled run handles up to **20 reels**: it refreshes stale reels first, then spends the rest of the budget on new ones. Everything goes to `main` as **one combined commit** with one push, and only when every check passes. Read `SCHEMA.md` before writing.

The goal is **retention through fun**: John should remember the fact because the reel made him smile. A reel that is accurate but flat has failed, and so has one that is funny but wrong.

## 1. Sync

```bash
git pull --rebase origin main
rm -rf .source && git clone --depth 1 https://github.com/john1hsu/salesforce-knowledge-graph .source/salesforce-knowledge-graph
pip install -r requirements.txt --break-system-packages -q
python3 scripts/validate.py          # the repo's own checks; must print OK; fix the repo first if not
```

## 2. Mark stale reels

```bash
python3 scripts/refresh.py mark-stale
python3 scripts/validate.py --source .source/salesforce-knowledge-graph    # must print OK
```

A reel goes stale when any of its source articles changed or was removed since the reel was verified. Always run `mark-stale` before validating against the source.

## 3. Pick this run's work

The budget is 20 reels per run (refreshed plus new). Repeat until it is used:

```bash
python3 scripts/generate.py pick --n 4
```

- `"mode": "refresh"` → do step 4a for every reel in `batch`, then pick again.
- `"mode": "generate"` → do step 4b for the `articles` listed (uncovered articles come first), then pick again.
- `"mode": "none"` → go to step 5.

Don't commit between picks.

## 4a. Refresh a stale reel

Read the reel file and the **current** version of each source article in full. Decide:

| Outcome | Command |
| --- | --- |
| Everything the reel says is still true per the article | `python3 scripts/refresh.py verify <id>` |
| A fact changed (new limit, renamed product, different behaviour) | Write one replacement reel to a JSON file (step 4b format), then `python3 scripts/refresh.py supersede <id> --input <file>` |
| The feature was retired, or the article is gone and nothing is left to say | `python3 scripts/refresh.py retire <id> --reason "<why>"` |

`verify` fails when a fact's evidence phrase is no longer in the article. If the fact still holds, supersede with a reel that quotes the new wording; otherwise supersede with the corrected fact.

## 4b. Write new reels

For each picked article, read the whole article (`.source/salesforce-knowledge-graph/<path>`). You may **combine** it with up to two related articles from `can_combine_with` when a connection makes a better reel (read those in full too, and list them in `sources`). One reel per picked article is the norm; write a second only when the article holds two clearly different, equally good ideas.

Write the reels to a JSON file outside the repo (the scratchpad) in the `SCHEMA.md` input format, then:

```bash
python3 scripts/generate.py add --input <file>
```

`add` checks each reel and writes only the ones that pass. For a rejected reel, fix what the message says and add it again once; if it fails a second time, drop it and move on.

### Writing a good reel

- **Setup and punchline.** Open with a hook in the first beat, build for two or three, and land the last beat on a line worth remembering. The punchline should carry the fact, or sit right next to it.
- **Pick the style that fits the article**: `fact` for something surprising, `story` for cause and effect, `humor` for a joke or everyday analogy, `myth` for a common misconception the article corrects. `styles_so_far` shows the mix; don't force balance, but don't let one style take over either.
- **One idea per reel.** 15–20 seconds is about 38–50 words. Cut everything that isn't the idea or the joke.
- **Mixed levels.** Some reels explain a basic to anyone; some reward an architect. Never talk down, never show off.
- **Grounding.** Every factual claim comes from the source article and has a `facts` entry with a word-for-word evidence phrase. No facts from memory, even true ones. Jokes, analogies and what characters do are invention and need no evidence, but they must never imply something false about the product.
- **Numbers.** State limits exactly as the article does. Spell a number out in `say` when that is how it should be heard, and put the digits on a `sign`.
- **Write for the ear.** The narrator is one synthetic voice reading `say` aloud. Short sentences. Avoid symbols, code and abbreviations it would mangle; say "S-O-Q-L" only if "SOQL" would be misread (it is usually fine).
- **Show it.** Every beat stages something: who is on screen, what they do, a prop, an effect. Use `anim`, `emote`, `fx` and `sfx` to make the joke land (a `rimshot` on a punchline, `alarm` when Gus arrives). Vary backdrops: the setting can be anything that suits the analogy, from the office to outer space (`backdrop_usage` shows what is overused).
- **Use the cast.** `library/cast.json` gives each character a personality and running gags. Keep them in character, reuse the gags, and let gags build across reels, but every reel must make sense on its own: the feed is shuffled, so no storylines or "last time".
- **Tone varies**: dry, silly, warm. Never mean. No jokes at the expense of any group of people, no real people, no real companies as villains, no exam case companies, and never Salesforce's own mascots or characters.
- **No copying.** Don't lift sentences from the article into `say`; tell it your own way. No song lyrics, film quotes or known characters.

### Growing the library

Add to the library when a reel needs something it lacks, in the same commit. Keep it purposeful: reuse before adding.

- **Prop** (`library/props.json`): a small sprite as character rows with a palette. Keep it readable at a glance: bold shapes, a dark outline colour, 2–5 colours.
- **Backdrop** (`library/backdrops.json`): layers on a 180×320 canvas with `ground` at 232. Start the sky at `y: 0` and run the floor to the bottom so it stretches on tall phones.
- **Cast member** (`library/cast.json`): only when a recurring role is missing and would be used again (at most one new character per run). Give them a name, role, personality and one or two gags, original and friendly. Add them to the cast table in `README.md`.

Run `python3 scripts/validate.py --no-render && node scripts/render_test.js` after any library change.

## 5. Validate, build, commit, push

```bash
python3 scripts/validate.py --source .source/salesforce-knowledge-graph    # fact, duplicate, length and render checks
python3 scripts/build_index.py
git add -A
git commit -m "<message>"
git pull --rebase origin main && git push origin main
```

- Make **one** commit for the whole run and push it once. Subject: `reels: refresh <r>, +<n> reels from <k> articles` (drop the part that is zero). In the body, one line per reel: `sr-000123: added (humor) <title>` / `verified` / `superseded by sr-000130` / `retired: <why>`, plus a line for each library addition.
- If validation fails on a new reel, fix it once; if it still fails, delete just that reel's file and carry on, so the final commit always validates. Report dropped reels in the run output.
- If the push is rejected, `git pull --rebase origin main`, re-run `build_index.py`, amend that same commit, and push once more.
- If nothing changed, stop without committing.

## Don'ts

- Don't handle more than 20 reels a run, or write more than 2 new reels from one article in a run.
- Don't delete reel files, reuse an id, or hand-edit `index/` or `coverage/`.
- Don't commit `.source/`, and never commit to, push to or open issues on the source repo.
- Don't commit if validation fails, and don't rewrite pushed history.
