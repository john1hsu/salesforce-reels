/* Salesforce Reels: full-screen feed. Swipe up for the next reel, down for the previous one,
 * tap to turn the narrator on or off, tap the corner label for the source article.
 * The feed learns from how long each reel is watched; everything it learns stays on this device. */
(function () {
  "use strict";
  var E = window.ReelEngine;
  var GRAPH_SITE = "https://john1hsu.github.io/salesforce-knowledge-graph/";
  var STORE = "salesforce-reels.v1";

  /* ---------- feed algorithm settings ---------- */
  var EXPLORE = 0.20;      // share of picks that ignore what has been learned
  var ALPHA = 0.30;        // how fast a score follows new watch ratios
  var FLOOR = 0.15;        // lowest weight a reel can have: skipped topics fade but never vanish
  var SHARPEN = 1.5;       // >1 makes preferences count for more
  var MAX_RATIO = 3;       // a reel left looping counts up to three full watches
  var SOURCE_TAP = 1.0;    // opening the source article counts like one extra full watch
  var NEUTRAL = 1.0;       // starting score: one full watch

  var $ = function (id) { return document.getElementById(id); };
  var stage = $("stage"), canvas = $("screen"), ctx = canvas.getContext("2d"), caption = $("caption"),
    sourceEl = $("source"), sourcesEl = $("sources"), mutedEl = $("muted"), statusEl = $("status");
  ctx.imageSmoothingEnabled = false;

  /* Phones are taller than 9:16. Rather than letterbox, the canvas grows and the backdrop's sky
   * and floor stretch into the extra rows; the scene itself keeps its 180x320 layout. */
  var ext = { top: 0, bottom: 0 };
  function fit() {
    var vw = window.innerWidth, vh = window.innerHeight, tall = vh / vw > 16 / 9;
    var h = tall ? Math.min(460, Math.round(E.W * vh / vw)) : E.H, extra = h - E.H;
    ext.top = Math.round(extra * 0.55); ext.bottom = extra - ext.top;
    stage.classList.toggle("tall", tall);
    if (canvas.height !== h) { canvas.height = h; ctx.imageSmoothingEnabled = false; }
  }
  window.addEventListener("resize", fit); fit();

  /* ---------- local state ---------- */
  function load() {
    try { var s = JSON.parse(localStorage.getItem(STORE) || "null"); if (s && s.scores) return s; } catch (e) { /* private mode */ }
    return { scores: { topic: {}, style: {}, cast: {} }, seen: {}, recent: [], sound: false };
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  var state = load();

  var manifest = [], byId = {}, lib = null;
  var trail = [], hpos = -1;         // reels shown this session, for swiping back
  var cur = null;                    // {meta, reel, tl, beat, beatStart, start, watched, tapped, wordIdx}
  var sound = false;                 // always starts muted: browsers need a tap before speech
  var raf = 0, lastTick = 0, speakToken = 0, sawBoundary = false, keepAlive = null;

  /* ---------- scoring ---------- */
  function score(kind, key) { var s = state.scores[kind][key]; return s ? s.s : NEUTRAL; }
  function learn(kind, key, ratio) {
    var s = state.scores[kind][key] || (state.scores[kind][key] = { s: NEUTRAL, n: 0 });
    s.s += ALPHA * (ratio - s.s); s.n += 1;
  }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : NEUTRAL; }
  function weight(m) {
    var parts = [mean(m.topics.map(function (t) { return score("topic", t); })), score("style", m.style)];
    if (m.cast.length) parts.push(mean(m.cast.map(function (c) { return score("cast", c); })));
    return Math.pow(Math.max(FLOOR, mean(parts)), SHARPEN);
  }
  function pickNext() {
    var avoid = cur ? cur.meta.id : null;
    var unseen = manifest.filter(function (m) { return !state.seen[m.id] && m.id !== avoid; });
    var pool = unseen;
    if (!pool.length) {                                   // everything watched: weighted replay
      var skip = state.recent.slice(-Math.min(10, Math.floor(manifest.length / 2)));
      pool = manifest.filter(function (m) { return m.id !== avoid && skip.indexOf(m.id) < 0; });
      if (!pool.length) pool = manifest.filter(function (m) { return m.id !== avoid; });
      if (!pool.length) pool = manifest;
    }
    if (Math.random() < EXPLORE) return pool[Math.floor(Math.random() * pool.length)];
    var ws = pool.map(weight), total = ws.reduce(function (a, b) { return a + b; }, 0), r = Math.random() * total;
    for (var i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  function record() {                                     // called when a reel leaves the screen
    if (!cur || cur.recorded) return;
    cur.recorded = true;
    var ratio = Math.min(MAX_RATIO, cur.watched / cur.tl.total) + (cur.tapped ? SOURCE_TAP : 0);
    var m = cur.meta;
    m.topics.forEach(function (t) { learn("topic", t, ratio); });
    learn("style", m.style, ratio);
    m.cast.forEach(function (c) { learn("cast", c, ratio); });
    state.seen[m.id] = (state.seen[m.id] || 0) + 1;
    state.recent.push(m.id); if (state.recent.length > 40) state.recent.shift();
    save();
  }

  /* ---------- sound: narrator (browser speech) and synthesized effects ---------- */
  var synth = window.speechSynthesis || null, voice = null, actx = null;
  function chooseVoice() {
    if (!synth) return;
    var vs = synth.getVoices() || [], best = null, bestScore = -1;
    vs.forEach(function (v) {
      if (!/^en/i.test(v.lang)) return;
      var sc = (/en[-_]US/i.test(v.lang) ? 2 : 1) + (v.localService ? 1 : 0) + (/samantha|google us english|aria|jenny|ava|allison/i.test(v.name) ? 3 : 0) - (/compact|novelty|whisper|bells|bad news|jester|organ|trinoids|zarvox|albert|bubbles|cellos|boing|wobble|good news|superstar/i.test(v.name) ? 5 : 0);
      if (sc > bestScore) { best = v; bestScore = sc; }
    });
    voice = best;
  }
  if (synth) { chooseVoice(); if (synth.addEventListener) synth.addEventListener("voiceschanged", chooseVoice); }

  function tone(freq, t0, dur, type, vol, slideTo) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || "square"; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol || 0.05, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(t0, dur, vol) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = actx.createBufferSource(), g = actx.createGain(); s.buffer = buf; g.gain.value = vol || 0.05;
    s.connect(g); g.connect(actx.destination); s.start(t0);
  }
  function sfx(name) {
    if (!sound || !name || name === "none") return;
    try {
      if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; actx = new AC(); }
      if (actx.state === "suspended") actx.resume();
      var t = actx.currentTime + 0.01;
      if (name === "blip") tone(880, t, 0.07);
      else if (name === "coin") { tone(988, t, 0.07); tone(1319, t + 0.07, 0.22); }
      else if (name === "jump") tone(300, t, 0.18, "square", 0.05, 900);
      else if (name === "error") { tone(196, t, 0.16, "sawtooth", 0.06); tone(147, t + 0.17, 0.28, "sawtooth", 0.06); }
      else if (name === "powerup") [523, 659, 784, 1047].forEach(function (f, i) { tone(f, t + i * 0.07, 0.1); });
      else if (name === "rimshot") { noise(t, 0.06, 0.07); noise(t + 0.13, 0.06, 0.07); tone(660, t + 0.3, 0.2, "triangle", 0.07); noise(t + 0.3, 0.25, 0.05); }
      else if (name === "fanfare") [523, 523, 523, 784].forEach(function (f, i) { tone(f, t + i * 0.11, i === 3 ? 0.4 : 0.09); });
      else if (name === "whoosh") noise(t, 0.3, 0.05);
      else if (name === "boing") tone(180, t, 0.3, "triangle", 0.09, 520);
      else if (name === "zap") tone(1400, t, 0.16, "sawtooth", 0.05, 120);
    } catch (e) { /* sound is optional */ }
  }

  function stopSpeech() { speakToken++; if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } } }
  function speakBeat() {
    if (!sound || !synth || !cur) return;
    var my = ++speakToken, c = cur, i = c.beat, text = c.reel.beats[i].say;
    sawBoundary = false;
    try {
      // Safari drops an utterance queued straight after cancel(), so only cancel when something
      // is actually playing, and then give it a moment before speaking.
      var busy = synth.speaking || synth.pending;
      if (busy) synth.cancel();
      if (!voice) chooseVoice();                       // phones load their voices late
      var u = new SpeechSynthesisUtterance(text);
      keepAlive = u;                                   // an unreferenced utterance can lose its end event
      if (voice) u.voice = voice;
      u.lang = (voice && voice.lang) || "en-US"; u.rate = 1.05; u.pitch = 1.0;
      u.onboundary = function (ev) {
        if (my !== speakToken || ev.name === "sentence") return;
        sawBoundary = true;
        c.wordIdx = text.slice(0, ev.charIndex).trim().split(/\s+/).filter(Boolean).length;
      };
      u.onend = function () { if (my === speakToken && cur === c && c.beat === i) c.spokenDone = performance.now(); };
      u.onerror = u.onend;
      c.spokenDone = 0; c.speaking = true;
      if (busy) setTimeout(function () { if (my === speakToken) synth.speak(u); }, 80);
      else synth.speak(u);                             // first tap: must run inside the gesture
    } catch (e) { c.speaking = false; }
  }
  function unlockAudio() {                               // must run inside a tap
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* older browsers */ }
    try {
      if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
      if (actx && actx.state !== "running") actx.resume();
    } catch (e) { /* effects are optional */ }
    try { if (synth && synth.paused) synth.resume(); } catch (e) { /* ignore */ }
  }
  function setSound(on) {
    sound = on; mutedEl.hidden = on;
    if (on) unlockAudio();
    if (on) { if (cur) { startBeat(cur.beat, true); } }
    else { stopSpeech(); if (cur) cur.speaking = false; }
  }

  /* ---------- playback ---------- */
  function setCaption(beat) {
    caption.textContent = "";
    cur.tl.beats[beat].words.forEach(function (w, i) {
      var s = document.createElement("span"); s.textContent = w;
      caption.appendChild(s);
      if (i < cur.tl.beats[beat].words.length - 1) caption.appendChild(document.createTextNode(" "));
    });
    cur.spans = caption.querySelectorAll("span"); cur.shown = -2;
  }
  function startBeat(i, restart) {
    cur.beat = i; cur.beatStart = performance.now(); cur.wordIdx = 0; cur.speaking = false; cur.spokenDone = 0;
    if (!restart || !cur.spans) setCaption(i); else cur.shown = -2;
    sfx(cur.reel.beats[i].sfx);
    if (sound) speakBeat();
  }
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!cur || document.hidden) { lastTick = now; return; }
    var dt = Math.min(0.25, (now - lastTick) / 1000); lastTick = now;
    cur.watched += dt;
    var b = cur.tl.beats[cur.beat], tb = (now - cur.beatStart) / 1000, last = cur.beat === cur.reel.beats.length - 1;
    var hold = E.GAP + (last ? E.END_HOLD : 0), done;
    if (sound && cur.speaking) done = cur.spokenDone ? (now - cur.spokenDone) / 1000 >= hold : tb > b.dur * 2.5 + 3;   // watchdog if speech events never fire
    else done = tb >= b.dur + hold;
    if (done) { startBeat(last ? 0 : cur.beat + 1); b = cur.tl.beats[cur.beat]; tb = 0; }
    var wi;
    if (sound && cur.speaking && sawBoundary) wi = cur.spokenDone ? b.words.length : cur.wordIdx;
    else wi = Math.floor(tb / b.dur * b.words.length);
    if (wi !== cur.shown) {
      cur.shown = wi;
      for (var k = 0; k < cur.spans.length; k++) cur.spans[k].className = k < wi ? "said" : (k === wi ? "now" : "");
    }
    var talking = sound && cur.speaking ? !cur.spokenDone : tb < b.dur;
    E.render(ctx, cur.reel, lib, cur.beat, Math.min(tb, b.dur + hold), (now - cur.start) / 1000, talking, ext);
  }

  function articleUrl(path) { return GRAPH_SITE + path.replace(/\.md$/, ".html"); }
  function showSources(reel) {
    var srcs = reel.sources || [];
    sourcesEl.hidden = true; sourcesEl.textContent = "";
    if (!srcs.length) { sourceEl.hidden = true; return; }
    sourceEl.hidden = false;
    sourceEl.textContent = srcs[0].title + (srcs.length > 1 ? " +" + (srcs.length - 1) : "");
    sourceEl.href = articleUrl(srcs[0].path);
    srcs.forEach(function (s) {
      var li = document.createElement("li"), a = document.createElement("a");
      a.textContent = s.title; a.href = articleUrl(s.path); a.target = "_blank"; a.rel = "noopener";
      li.appendChild(a); sourcesEl.appendChild(li);
    });
  }

  function show(meta, dir) {
    record(); stopSpeech();
    statusEl.textContent = "";
    return fetch("reels/" + meta.file, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
    }).then(function (reel) {
      var errs = E.checkReel(reel, lib);
      if (errs.length) throw new Error(errs[0]);
      stage.classList.add(dir === "down" ? "out-down" : "out-up");
      setTimeout(function () {
        cur = { meta: meta, reel: reel, tl: E.timeline(reel), watched: 0, tapped: false, start: performance.now() };
        showSources(reel);
        startBeat(0);
        stage.classList.add("in"); stage.classList.remove("out-up", "out-down");
        void stage.offsetWidth; stage.classList.remove("in");
        try { window.history.replaceState(null, "", "#" + meta.id); } catch (e) { /* ignore */ }
      }, cur ? 150 : 0);
    }).catch(function (e) {
      console.error("reel " + meta.id + " failed:", e);
      meta.broken = true; manifest = manifest.filter(function (m) { return !m.broken; });
      if (manifest.length) return next(); statusEl.textContent = "No reels could be loaded";
    });
  }
  function next() {
    if (!manifest.length) return;
    if (hpos < trail.length - 1) { hpos++; return show(trail[hpos], "up"); }
    var m = pickNext(); trail.push(m); hpos = trail.length - 1;
    return show(m, "up");
  }
  function prev() { if (hpos > 0) { hpos--; show(trail[hpos], "down"); } }

  /* ---------- gestures: swipe up/down, tap for sound ---------- */
  var p0 = null;
  stage.addEventListener("pointerdown", function (e) { p0 = { x: e.clientX, y: e.clientY, t: performance.now(), target: e.target }; });
  stage.addEventListener("pointerup", function (e) {
    if (!p0) return;
    var dx = e.clientX - p0.x, dy = e.clientY - p0.y, dt = performance.now() - p0.t, target = p0.target; p0 = null;
    if (Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx) * 1.2) { sourcesEl.hidden = true; if (dy < 0) next(); else prev(); return; }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 500) {
      if (target === sourceEl || sourcesEl.contains(target)) return;        // handled by click below
      if (!sourcesEl.hidden) { sourcesEl.hidden = true; return; }
      setSound(!sound);
    }
  });
  stage.addEventListener("pointercancel", function () { p0 = null; });
  sourceEl.addEventListener("click", function (e) {
    if (cur) cur.tapped = true;
    if (cur && (cur.reel.sources || []).length > 1) { e.preventDefault(); sourcesEl.hidden = !sourcesEl.hidden; }
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "j") next();
    else if (e.key === "ArrowUp" || e.key === "k") prev();
    else if (e.key === " " || e.key === "m") { e.preventDefault(); setSound(!sound); }
  });
  window.addEventListener("wheel", (function () {
    var lock = 0;
    return function (e) { var now = Date.now(); if (now < lock || Math.abs(e.deltaY) < 30) return; lock = now + 700; if (e.deltaY > 0) next(); else prev(); };
  })(), { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { stopSpeech(); if (cur) cur.speaking = false; save(); }
    else if (cur) { lastTick = performance.now(); startBeat(cur.beat, true); }
  });
  window.addEventListener("pagehide", function () { record(); });

  /* ---------- boot ---------- */
  function get(url) { return fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(url + ": HTTP " + r.status); return r.json(); }); }
  statusEl.textContent = "Loading";
  Promise.all([get("manifest.json"), get("library/cast.json"), get("library/props.json"), get("library/backdrops.json")]).then(function (r) {
    manifest = (r[0].reels || []).map(function (m) { return { id: m.id, file: m.file, style: m.style, topics: m.topics || [], cast: m.cast || [] }; });
    manifest.forEach(function (m) { byId[m.id] = m; });
    lib = E.makeLib(r[1], r[2], r[3]);
    mutedEl.hidden = false;
    if (!manifest.length) { statusEl.textContent = "No reels yet. The first batch is on its way."; return; }
    var want = byId[(location.hash || "").slice(1)];
    lastTick = performance.now(); raf = requestAnimationFrame(tick);
    if (want) { trail.push(want); hpos = 0; show(want, "up"); } else next();
  }).catch(function (e) { console.error(e); statusEl.textContent = "Could not load the reels. Check your connection."; });

  window.__reels = { state: function () { return state; }, weight: weight, manifest: function () { return manifest; } };
})();
