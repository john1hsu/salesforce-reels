#!/usr/bin/env node
/* Render test: plays every reel in the feed through the engine, frame by frame, against a
 * recording canvas. Fails if anything throws, references something the library lacks, or a
 * beat draws nothing.   node scripts/render_test.js [sr-000001 ...] */
"use strict";
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const E = require(path.join(root, "app", "engine.js"));
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

function mockCtx() {
  const c = { calls: 0, bad: 0, fillStyle: "#000", font: "", textAlign: "", textBaseline: "" };
  c.fillRect = (x, y, w, h) => { c.calls++; if (![x, y, w, h].every(Number.isFinite)) c.bad++; if (typeof c.fillStyle !== "string" || /undefined|NaN/.test(c.fillStyle)) c.bad++; };
  c.fillText = (t, x, y) => { c.calls++; if (![x, y].every(Number.isFinite)) c.bad++; };
  c.save = c.restore = () => {};
  c.translate = (x, y) => { if (![x, y].every(Number.isFinite)) c.bad++; };
  return c;
}

const lib = E.makeLib(read("library/cast.json"), read("library/props.json"), read("library/backdrops.json"));
const problems = E.checkLibrary(lib).map((m) => "library: " + m);
const ctx = mockCtx();

// every library item must draw on its own, so a new sprite can't break a later reel
for (const id of Object.keys(lib.backdrops)) try { E.drawBackdrop(ctx, lib.backdrops[id], lib, 1.3); E.drawBackdrop(ctx, lib.backdrops[id], lib, 2.1, { top: 40, bottom: 30 }); } catch (e) { problems.push(`backdrop ${id}: ${e.message}`); }
for (const id of Object.keys(lib.props)) try { E.drawProp(ctx, lib.props[id], 10, 10, 3, false); } catch (e) { problems.push(`prop ${id}: ${e.message}`); }
for (const id of Object.keys(lib.cast)) for (const o of [{}, { armsUp: true, talk: true, flip: true, step: 1, blink: true, bob: true }])
  try { E.drawCharacter(ctx, lib.cast[id], 20, 20, 3, o); } catch (e) { problems.push(`cast ${id}: ${e.message}`); }

const only = process.argv.slice(2);
let played = 0;
const dir = path.join(root, "reels");
for (const topic of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
  const tdir = path.join(dir, topic);
  if (!fs.statSync(tdir).isDirectory()) continue;
  for (const f of fs.readdirSync(tdir).sort()) {
    if (!/^sr-\d{6}\.json$/.test(f)) continue;
    const reel = JSON.parse(fs.readFileSync(path.join(tdir, f), "utf8"));
    if (only.length ? !only.includes(reel.id) : !["active", "stale"].includes(reel.status)) continue;
    const errs = E.checkReel(reel, lib);
    if (errs.length) { errs.forEach((m) => problems.push(`${reel.id}: ${m}`)); continue; }
    try {
      const tl = E.timeline(reel);
      let tg = 0;
      tl.beats.forEach((b, i) => {
        const before = ctx.calls;
        for (let t = 0; t <= b.dur + E.GAP; t += 0.1) { E.render(ctx, reel, lib, i, t, tg, t < b.dur, i % 2 ? { top: 40, bottom: 30 } : null); tg += 0.1; }
        if (ctx.calls === before) problems.push(`${reel.id}: beat ${i + 1} drew nothing`);
      });
      played++;
    } catch (e) { problems.push(`${reel.id}: ${e.stack.split("\n").slice(0, 2).join(" ")}`); }
  }
}
if (ctx.bad) problems.push(`${ctx.bad} draw call(s) had a missing colour or a non-numeric position`);
if (problems.length) { problems.forEach((m) => console.log(m)); console.log(`RENDER TEST FAILED: ${problems.length} problem(s)`); process.exit(1); }
console.log(`render test OK: ${played} reels, ${Object.keys(lib.cast).length} cast, ${Object.keys(lib.props).length} props, ${Object.keys(lib.backdrops).length} backdrops`);
