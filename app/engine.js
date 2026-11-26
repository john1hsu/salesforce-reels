/* Salesforce Reels engine: turns a reel script (JSON) into 16-bit style pixel-art frames.
 * Pure drawing and timing, no DOM: the browser app and scripts/render_test.js both use it. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ReelEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var W = 180, H = 320;          // logical pixels (9:16), scaled up with nearest-neighbour
  var WPS = 2.7;                 // narration speed used for timing (words per second)
  var MIN_BEAT = 1.2, GAP = 0.35, END_HOLD = 1.2;

  var ACTOR_ANIMS = ["idle", "talk", "enter-left", "enter-right", "exit-left", "exit-right",
    "jump", "shake", "cheer", "spin", "sulk", "run", "float", "faint", "nod"];
  var PROP_ANIMS = ["none", "bob", "spin", "drop", "pulse", "fly-left", "fly-right", "grow", "shake", "rise"];
  var FX = ["none", "shake", "flash", "confetti", "rain", "sparkle", "alarm", "dark", "snow"];
  var SFX = ["none", "blip", "coin", "jump", "error", "powerup", "rimshot", "fanfare", "whoosh", "boing", "zap"];
  var EMOTES = ["!", "?", "...", "heart", "idea", "sweat", "anger", "zzz", "star"];
  var BACKDROP_OPS = ["rect", "grad", "checker", "stripes", "bricks", "stars", "hills", "prop", "window", "sun", "skyline"];
  var HAIR = ["short", "long", "bun", "spiky", "bald", "curly", "ponytail"];
  var ACCESSORIES = ["glasses", "headset", "tie", "cap", "whistle", "mug", "cape", "badge", "bowtie", "scarf", "hardhat", "crown"];
  var KINDS = ["human", "robot"];

  function words(s) { return String(s || "").trim().split(/\s+/).filter(Boolean); }
  function beatSeconds(beat) { return Math.max(MIN_BEAT, words(beat.say).length / WPS); }
  function speechSeconds(reel) {
    var t = 0;
    (reel.beats || []).forEach(function (b) { t += beatSeconds(b) + GAP; });
    return t;
  }
  function timeline(reel) {
    var t = 0, out = [];
    (reel.beats || []).forEach(function (b) {
      var d = beatSeconds(b);
      out.push({ start: t, dur: d, words: words(b.say) });
      t += d + GAP;
    });
    return { beats: out, speech: t, total: t + END_HOLD };
  }

  /* ---------- colour helpers ---------- */
  function hex(c) {
    c = String(c).replace("#", "");
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  }
  function rgb(a) {
    return "#" + a.map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }
  function shade(c, f) { var a = hex(c); return rgb([a[0] * f, a[1] * f, a[2] * f]); }
  function mix(c1, c2, t) { var a = hex(c1), b = hex(c2); return rgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  function rnd(seed) { var x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ---------- library lookup ---------- */
  function makeLib(cast, props, backdrops) {
    var lib = { cast: {}, props: {}, backdrops: {} };
    ((cast && cast.characters) || []).forEach(function (c) { lib.cast[c.id] = c; });
    ((props && props.props) || []).forEach(function (p) { lib.props[p.id] = p; });
    ((backdrops && backdrops.backdrops) || []).forEach(function (b) { lib.backdrops[b.id] = b; });
    return lib;
  }

  /* ---------- structural check shared by the app and the render test ---------- */
  function checkReel(reel, lib) {
    var errs = [];
    if (!lib.backdrops[reel.backdrop]) errs.push("unknown backdrop: " + reel.backdrop);
    (reel.beats || []).forEach(function (b, i) {
      var at = "beat " + (i + 1) + ": ";
      (b.actors || []).forEach(function (a) {
        if (!lib.cast[a.id]) errs.push(at + "unknown cast member " + a.id);
        if (a.anim && ACTOR_ANIMS.indexOf(a.anim) < 0) errs.push(at + "unknown actor anim " + a.anim);
        if (a.emote && EMOTES.indexOf(a.emote) < 0) errs.push(at + "unknown emote " + a.emote);
      });
      (b.props || []).forEach(function (p) {
        if (!lib.props[p.id]) errs.push(at + "unknown prop " + p.id);
        if (p.anim && PROP_ANIMS.indexOf(p.anim) < 0) errs.push(at + "unknown prop anim " + p.anim);
      });
      if (b.fx && FX.indexOf(b.fx) < 0) errs.push(at + "unknown fx " + b.fx);
      if (b.sfx && SFX.indexOf(b.sfx) < 0) errs.push(at + "unknown sfx " + b.sfx);
      if (b.speaker && !lib.cast[b.speaker]) errs.push(at + "unknown speaker " + b.speaker);
    });
    return errs;
  }
  function checkLibrary(lib) {
    var errs = [];
    Object.keys(lib.props).forEach(function (id) {
      var p = lib.props[id], w = null;
      if (!p.rows || !p.rows.length) errs.push("prop " + id + ": no rows");
      (p.rows || []).forEach(function (r) {
        if (w === null) w = r.length; else if (r.length !== w) errs.push("prop " + id + ": ragged rows");
        r.split("").forEach(function (ch) { if (ch !== "." && !(p.palette || {})[ch]) errs.push("prop " + id + ": no colour for '" + ch + "'"); });
      });
    });
    Object.keys(lib.cast).forEach(function (id) {
      var c = lib.cast[id];
      if (KINDS.indexOf(c.kind || "human") < 0) errs.push("cast " + id + ": unknown kind " + c.kind);
      if ((c.kind || "human") === "human" && HAIR.indexOf(c.hair || "short") < 0) errs.push("cast " + id + ": unknown hair " + c.hair);
      (c.accessories || []).forEach(function (a) { if (ACCESSORIES.indexOf(a) < 0) errs.push("cast " + id + ": unknown accessory " + a); });
    });
    Object.keys(lib.backdrops).forEach(function (id) {
      var b = lib.backdrops[id];
      if (typeof b.ground !== "number") errs.push("backdrop " + id + ": ground must be a number");
      (b.layers || []).forEach(function (l) {
        if (BACKDROP_OPS.indexOf(l.op) < 0) errs.push("backdrop " + id + ": unknown op " + l.op);
        if (l.op === "prop" && !lib.props[l.id]) errs.push("backdrop " + id + ": unknown prop " + l.id);
      });
    });
    return errs;
  }

  /* ---------- drawing primitives ---------- */
  function R(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

  function drawProp(ctx, prop, x, y, s, flip) {
    var rows = prop.rows, pal = prop.palette, h = rows.length, w = rows[0].length;
    for (var j = 0; j < h; j++) {
      var row = rows[j];
      for (var i = 0; i < w; i++) {
        var ch = row[flip ? w - 1 - i : i];
        if (ch === ".") continue;
        R(ctx, x + i * s, y + j * s, s, s, pal[ch]);
      }
    }
  }
  function propSize(prop, s) { return { w: prop.rows[0].length * s, h: prop.rows.length * s }; }

  /* A character is drawn from a short spec (see library/cast.json) on a 16x22 grid. */
  function drawCharacter(ctx, spec, ox, oy, s, o) {
    o = o || {};
    var f = o.flip ? -1 : 1;
    function px(x, y, w, h, c) {
      var xx = o.flip ? 16 - x - w : x;
      R(ctx, ox + xx * s, oy + y * s, w * s, h * s, c);
    }
    var bob = o.bob ? 1 : 0, armsUp = !!o.armsUp, talk = !!o.talk, step = o.step || 0, blink = !!o.blink;
    var acc = spec.accessories || [];
    function has(a) { return acc.indexOf(a) >= 0; }

    if ((spec.kind || "human") === "robot") {
      var body = spec.body || "#9aa7b8", eye = spec.eye || "#5ef0ff", trim = spec.trim || "#ffb000";
      px(7, 0 + bob, 2, 1, trim); px(7.5, 1 + bob, 1, 2, shade(body, 0.6));           // antenna
      px(3, 3 + bob, 10, 8, body); px(11, 3 + bob, 2, 8, shade(body, 0.78));          // head
      px(3, 3 + bob, 10, 1, shade(body, 1.2));
      px(4, 5 + bob, 8, 3, "#1b2433");                                                 // visor
      if (!blink) { px(5, 6 + bob, 2, 1, eye); px(9, 6 + bob, 2, 1, eye); }
      px(6, 9 + bob, 4, 1, talk ? eye : shade(body, 0.55));                            // mouth grille
      px(4, 12, 8, 6, shade(body, 0.9)); px(10, 12, 2, 6, shade(body, 0.7));           // torso
      px(6, 13, 3, 2, trim);                                                           // chest light
      if (armsUp) { px(2, 7, 2, 6, shade(body, 0.75)); px(12, 7, 2, 6, shade(body, 0.75)); }
      else { px(2, 12, 2, 5, shade(body, 0.75)); px(12, 12, 2, 5, shade(body, 0.75)); }
      px(4, 18, 8, 2, "#2a3242");                                                      // track
      px(4 + (step ? 1 : 0), 20, 2, 2, "#11161f"); px(9 + (step ? 1 : 0), 20, 2, 2, "#11161f");
      if (has("cape")) px(1, 12, 2, 7, spec.cape || "#c0392b");
      if (has("crown")) { px(4, 1 + bob, 8, 2, "#f6c945"); px(4, 0 + bob, 1, 1, "#f6c945"); px(7.5, 0 + bob, 1, 1, "#f6c945"); px(11, 0 + bob, 1, 1, "#f6c945"); }
      return;
    }

    var skin = spec.skin || "#f1c59b", hair = spec.hairColor || "#3b2a1e", shirt = spec.shirt || "#3b82c4",
      pants = spec.pants || "#2d3550", shoes = spec.shoes || "#1c1c22", style = spec.hair || "short";
    var hy = 3 + bob;                                                                  // head top

    if (has("cape")) px(2, 11, 12, 9, spec.cape || "#c0392b");
    if (style === "long") px(3, hy + 2, 10, 9, shade(hair, 0.85));
    if (style === "ponytail") px(1, hy + 2, 2, 6, shade(hair, 0.85));

    // legs and shoes
    var l1 = step === 1 ? -1 : 0, l2 = step === 2 ? -1 : 0;
    px(5, 18, 3, 3 + l1, pants); px(8, 18, 3, 3 + l2, shade(pants, 0.85));
    px(4, 21 + l1, 4, 1, shoes); px(8, 21 + l2, 4, 1, shoes);
    // torso
    px(4, 11 + bob, 8, 7 - bob, shirt); px(10, 11 + bob, 2, 7 - bob, shade(shirt, 0.8));
    px(6, 11 + bob, 4, 1, shade(shirt, 1.2));
    // arms
    if (armsUp) {
      px(2, 6 + bob, 2, 6, shade(shirt, 0.9)); px(12, 6 + bob, 2, 6, shade(shirt, 0.75));
      px(2, 5 + bob, 2, 1, skin); px(12, 5 + bob, 2, 1, skin);
    } else {
      px(2, 11 + bob, 2, 5, shade(shirt, 0.9)); px(12, 11 + bob, 2, 5, shade(shirt, 0.75));
      px(2, 16 + bob, 2, 1, skin); px(12, 16 + bob, 2, 1, skin);
    }
    // head
    px(4, hy, 8, 8, skin); px(11, hy, 1, 8, shade(skin, 0.86)); px(5, hy + 8, 6, 0, skin);
    px(7, hy + 8, 2, 1, shade(skin, 0.86));                                            // neck
    // hair
    if (style !== "bald") {
      px(4, hy - 1, 8, 2, hair); px(3, hy, 1, 3, hair); px(12, hy, 1, 3, hair);
      if (style === "spiky") { px(4, hy - 2, 1, 1, hair); px(6, hy - 3, 2, 2, hair); px(9, hy - 2, 2, 1, hair); px(11, hy - 2, 1, 1, hair); }
      if (style === "bun") { px(6, hy - 4, 4, 3, hair); px(7, hy - 5, 2, 1, hair); }
      if (style === "curly") { px(3, hy - 2, 10, 2, hair); px(2, hy, 2, 4, hair); px(12, hy, 2, 4, hair); px(4, hy - 3, 2, 1, hair); px(8, hy - 3, 3, 1, hair); }
      if (style === "long" || style === "ponytail") { px(3, hy, 1, 6, hair); px(12, hy, 1, 6, hair); }
      px(4, hy + 1, 2, 1, hair);
    }
    // face
    if (blink) { px(5, hy + 4, 2, 1, shade(skin, 0.6)); px(9, hy + 4, 2, 1, shade(skin, 0.6)); }
    else { px(5, hy + 3, 2, 2, "#ffffff"); px(9, hy + 3, 2, 2, "#ffffff"); px(6, hy + 3, 1, 2, "#1d1d28"); px(10, hy + 3, 1, 2, "#1d1d28"); }
    if (talk) px(7, hy + 6, 2, 2, "#7a2a2a"); else px(7, hy + 6, 2, 1, shade(skin, 0.6));
    // accessories
    if (has("glasses")) { px(4, hy + 2, 4, 1, "#20222e"); px(8, hy + 2, 4, 1, "#20222e"); px(4, hy + 5, 4, 1, "#20222e"); px(8, hy + 5, 4, 1, "#20222e"); px(4, hy + 3, 1, 2, "#20222e"); px(11, hy + 3, 1, 2, "#20222e"); px(7.5, hy + 3, 1, 1, "#20222e"); }
    if (has("headset")) { px(3, hy - 2, 10, 1, "#20222e"); px(2, hy + 1, 2, 4, "#20222e"); px(2, hy + 5, 4, 1, "#20222e"); px(5, hy + 6, 1, 1, "#e94f4f"); }
    if (has("cap")) { px(3, hy - 2, 10, 3, spec.hat || "#c0392b"); px(10, hy, 5, 1, shade(spec.hat || "#c0392b", 0.75)); }
    if (has("hardhat")) { px(3, hy - 2, 10, 3, "#f6c945"); px(2, hy, 12, 1, "#d9a82a"); px(7, hy - 3, 2, 1, "#f6c945"); }
    if (has("crown")) { px(4, hy - 2, 8, 2, "#f6c945"); px(4, hy - 3, 1, 1, "#f6c945"); px(7.5, hy - 3, 1, 1, "#f6c945"); px(11, hy - 3, 1, 1, "#f6c945"); px(7.5, hy - 1, 1, 1, "#e94f4f"); }
    if (has("tie")) { px(7, 11 + bob, 2, 1, "#ffffff"); px(7.5, 12 + bob, 1, 4, spec.tie || "#c0392b"); }
    if (has("bowtie")) { px(6, 11 + bob, 4, 1, spec.tie || "#c0392b"); px(7.5, 11 + bob, 1, 1, shade(spec.tie || "#c0392b", 0.6)); }
    if (has("scarf")) { px(4, 11 + bob, 8, 1, spec.scarf || "#e9a23b"); px(9, 12 + bob, 2, 3, spec.scarf || "#e9a23b"); }
    if (has("badge")) px(9, 13 + bob, 2, 2, "#f6c945");
    if (has("whistle")) { px(9, hy + 6, 2, 1, "#f6c945"); px(11, hy + 6, 1, 2, "#f6c945"); }
    if (has("mug") && !armsUp) { px(13, 14 + bob, 3, 3, "#f4f4f4"); px(15.5, 15 + bob, 1, 1, "#f4f4f4"); px(13, 14 + bob, 3, 1, "#6b4226"); }
  }

  function drawEmote(ctx, kind, x, y, t) {
    var up = Math.round(Math.sin(t * 6) * 1.5);
    y += up;
    R(ctx, x - 1, y - 1, 15, 14, "#1a1c2c"); R(ctx, x, y, 13, 12, "#ffffff"); R(ctx, x + 3, y + 12, 3, 3, "#ffffff");
    var c = "#1a1c2c";
    if (kind === "!") { R(ctx, x + 5, y + 2, 3, 5, "#e23b3b"); R(ctx, x + 5, y + 8, 3, 2, "#e23b3b"); }
    else if (kind === "?") { R(ctx, x + 4, y + 2, 5, 2, "#2f6fd6"); R(ctx, x + 7, y + 4, 2, 2, "#2f6fd6"); R(ctx, x + 5, y + 6, 3, 1, "#2f6fd6"); R(ctx, x + 5, y + 8, 3, 2, "#2f6fd6"); }
    else if (kind === "...") { for (var i = 0; i < 3; i++) R(ctx, x + 2 + i * 4, y + 5, 2, 2, (Math.floor(t * 3) % 3) >= i ? c : "#b8bcc8"); }
    else if (kind === "heart") { R(ctx, x + 3, y + 3, 3, 3, "#e23b6b"); R(ctx, x + 7, y + 3, 3, 3, "#e23b6b"); R(ctx, x + 4, y + 5, 5, 3, "#e23b6b"); R(ctx, x + 6, y + 8, 1, 1, "#e23b6b"); }
    else if (kind === "idea") { R(ctx, x + 4, y + 2, 5, 5, "#f6c945"); R(ctx, x + 5, y + 7, 3, 2, "#8a8f9e"); }
    else if (kind === "sweat") { R(ctx, x + 6, y + 2, 2, 2, "#4aa8e8"); R(ctx, x + 5, y + 4, 4, 5, "#4aa8e8"); }
    else if (kind === "anger") { R(ctx, x + 3, y + 3, 3, 1, "#e23b3b"); R(ctx, x + 3, y + 3, 1, 3, "#e23b3b"); R(ctx, x + 7, y + 6, 3, 1, "#e23b3b"); R(ctx, x + 9, y + 4, 1, 3, "#e23b3b"); R(ctx, x + 7, y + 3, 1, 2, "#e23b3b"); R(ctx, x + 4, y + 7, 2, 1, "#e23b3b"); }
    else if (kind === "zzz") { R(ctx, x + 3, y + 3, 4, 1, c); R(ctx, x + 5, y + 4, 1, 1, c); R(ctx, x + 4, y + 5, 1, 1, c); R(ctx, x + 3, y + 6, 4, 1, c); R(ctx, x + 8, y + 7, 3, 1, c); R(ctx, x + 9, y + 8, 1, 1, c); R(ctx, x + 8, y + 9, 3, 1, c); }
    else if (kind === "star") { R(ctx, x + 6, y + 2, 1, 8, "#f6c945"); R(ctx, x + 2, y + 5, 9, 2, "#f6c945"); R(ctx, x + 4, y + 4, 5, 4, "#f6c945"); }
  }

  function drawBackdrop(ctx, bd, lib, t, ext) {
    var top = (ext && ext.top) || 0, bottom = (ext && ext.bottom) || 0;
    R(ctx, 0, -top, W, H + top + bottom, bd.base || "#1a1c2c");
    (bd.layers || []).forEach(function (src, li) {
      var i, n, x, y, l = src;
      if (["rect", "grad", "checker", "stripes", "bricks"].indexOf(src.op) >= 0) {
        var ly = src.y || 0, lh = src.h == null ? H - ly : src.h;
        l = Object.assign({}, src, { y: ly, h: lh });
        if (ly + lh >= H) l.h += bottom;                 // touches the bottom edge: extend down
        if (ly <= 0) { l.y = ly - top; l.h += top; }     // touches the top edge: extend up
      } else if (src.op === "hills" && bottom) l = Object.assign({}, src, { h: (src.h || 40) + bottom });
      if (l.op === "rect") R(ctx, l.x || 0, l.y, l.w == null ? W : l.w, l.h, l.c);
      else if (l.op === "grad") {                       // banded gradient, 16-bit style
        n = l.steps || 8;
        for (i = 0; i < n; i++) R(ctx, 0, l.y + Math.floor(l.h * i / n), W, Math.ceil(l.h / n) + 1, mix(l.from, l.to, n === 1 ? 0 : i / (n - 1)));
      } else if (l.op === "checker") {
        var sz = l.size || 10;
        for (y = 0; y * sz < l.h; y++) for (x = 0; x * sz < (l.w || W); x++)
          R(ctx, (l.x || 0) + x * sz, l.y + y * sz, sz, Math.min(sz, l.h - y * sz), (x + y) % 2 ? l.c1 : l.c2);
      } else if (l.op === "stripes") {
        var sw = l.size || 8;
        for (x = 0; x * sw < W; x++) R(ctx, x * sw, l.y, sw, l.h, x % 2 ? l.c1 : l.c2);
      } else if (l.op === "bricks") {
        R(ctx, 0, l.y, W, l.h, l.c1);
        for (y = 0; y * 8 < l.h; y++) { R(ctx, 0, l.y + y * 8, W, 1, l.c2); for (x = 0; x < 9; x++) R(ctx, x * 22 + (y % 2 ? 11 : 0), l.y + y * 8, 1, 8, l.c2); }
      } else if (l.op === "stars") {
        for (i = 0; i < (l.n || 30); i++) {
          var tw = rnd(i * 3.1 + li) > 0.7 && Math.floor(t * 2 + i) % 3 === 0;
          R(ctx, Math.floor(rnd(i + li * 9) * W), Math.floor(rnd(i * 7.7 + li) * (l.yMax || 160)), 1, 1, tw ? "#ffffff" : (l.c || "#c9d4ff"));
        }
      } else if (l.op === "hills") {
        for (x = 0; x < W; x += 2) {
          var hh = (l.amp || 14) * (0.5 + 0.5 * Math.sin(x * (l.freq || 0.045) + (l.seed || 0))) + (l.amp || 14) * 0.3 * Math.sin(x * 0.13 + (l.seed || 0) * 2);
          R(ctx, x, l.y - hh, 2, hh + (l.h || 40), l.c);
        }
      } else if (l.op === "prop") {
        drawProp(ctx, lib.props[l.id], l.x, l.y, l.s || 2, !!l.flip);
      } else if (l.op === "window") {
        R(ctx, l.x - 2, l.y - 2, l.w + 4, l.h + 4, l.frame || "#3a2f2a");
        R(ctx, l.x, l.y, l.w, l.h, l.c || "#7ec8f2"); R(ctx, l.x, l.y + l.h * 0.6, l.w, l.h * 0.4, shade(l.c || "#7ec8f2", 0.85));
        R(ctx, l.x + l.w / 2 - 1, l.y, 2, l.h, l.frame || "#3a2f2a"); R(ctx, l.x, l.y + l.h / 2 - 1, l.w, 2, l.frame || "#3a2f2a");
      } else if (l.op === "sun") {
        var r = l.r || 14;
        for (y = -r; y <= r; y += 2) { var ww = Math.floor(Math.sqrt(r * r - y * y)); R(ctx, l.x - ww, l.y + y, ww * 2, 2, l.c || "#ffd75e"); }
      } else if (l.op === "skyline") {
        for (i = 0; i < 12; i++) {
          var bw = 12 + Math.floor(rnd(i + (l.seed || 1)) * 10), bh = 24 + Math.floor(rnd(i * 5 + (l.seed || 1)) * (l.amp || 50));
          x = i * 16 - 4;
          R(ctx, x, l.y - bh, bw, bh, l.c);
          for (var wy = l.y - bh + 4; wy < l.y - 4; wy += 6) for (var wx = x + 2; wx < x + bw - 2; wx += 4)
            if (rnd(wx * 1.3 + wy * 2.7) > 0.45) R(ctx, wx, wy, 2, 3, l.lit || "#ffe08a");
        }
      }
    });
  }

  function ease(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  /* Draw one frame. beat = index into reel.beats, tb = seconds into that beat, tg = seconds since
   * the reel started (drives idle loops), speaking = whether narration is running right now. */
  function render(ctx, reel, lib, beat, tb, tg, speaking, ext) {
    var bd = lib.backdrops[reel.backdrop], b = reel.beats[beat], dur = beatSeconds(b);
    var top = (ext && ext.top) || 0, bottom = (ext && ext.bottom) || 0, FH = H + top + bottom;
    var fx = b.fx || "none", sx = 0, sy = 0;
    if (fx === "shake" || fx === "alarm") { sx = Math.round(Math.sin(tg * 60) * 2); sy = Math.round(Math.cos(tg * 47) * 2); }
    ctx.save();
    ctx.translate(sx, sy + top);
    drawBackdrop(ctx, bd, lib, tg, ext);
    var ground = bd.ground;

    (b.props || []).forEach(function (p, i) {
      var prop = lib.props[p.id], s = p.scale || 3, size = propSize(prop, s);
      var x = (p.x == null ? 50 : p.x) / 100 * W - size.w / 2;
      var y = p.y == null ? ground - size.h : p.y / 100 * H - size.h / 2;
      var a = p.anim || "none", flip = !!p.flip;
      if (a === "bob") y += Math.round(Math.sin(tg * 3 + i) * 3);
      else if (a === "rise") y -= Math.round(tb * 14);
      else if (a === "shake") x += Math.round(Math.sin(tg * 40) * 2);
      else if (a === "drop") { var k = Math.min(1, tb / 0.5); y = -size.h + (y + size.h) * k * k; if (k >= 1) y -= Math.max(0, Math.round(Math.sin((tb - 0.5) * 18) * 4 * Math.max(0, 1 - (tb - 0.5) * 2))); }
      else if (a === "pulse") { s = s + (Math.floor(tg * 4) % 2 ? 1 : 0); size = propSize(prop, s); x = (p.x == null ? 50 : p.x) / 100 * W - size.w / 2; }
      else if (a === "grow") { s = Math.max(1, Math.round(s * ease(tb / 0.8))); var g = propSize(prop, s); x += (size.w - g.w) / 2; y += size.h - g.h; }
      else if (a === "fly-left") x = W + 10 - (W + size.w + 20) * (tb / Math.max(1.2, dur));
      else if (a === "fly-right") x = -size.w - 10 + (W + size.w + 20) * (tb / Math.max(1.2, dur));
      else if (a === "spin") flip = Math.floor(tg * 5) % 2 === 1;
      drawProp(ctx, prop, x, y, s, flip);
    });

    (b.actors || []).forEach(function (a, i) {
      var spec = lib.cast[a.id], s = a.scale || 3, cw = 16 * s, ch = 22 * s;
      var x = (a.x == null ? 50 : a.x) / 100 * W - cw / 2, y = ground - ch;
      var anim = a.anim || "idle", o = { flip: !!a.flip };
      var isSpeaker = b.speaker === a.id;
      o.blink = Math.floor(tg * 10 + i * 7) % 37 === 0;
      o.bob = Math.floor(tg * 2 + i) % 2 === 1;
      if (isSpeaker || anim === "talk") o.talk = speaking !== false && Math.floor(tg * 7) % 2 === 0;
      if (anim === "enter-left") { var k1 = ease(tb / 0.7); x = -cw + (x + cw) * k1; if (k1 < 1) o.step = 1 + Math.floor(tg * 8) % 2; }
      else if (anim === "enter-right") { var k2 = ease(tb / 0.7); x = W + (x - W) * k2; o.flip = !a.flip ? true : false; if (k2 < 1) o.step = 1 + Math.floor(tg * 8) % 2; else o.flip = !!a.flip; }
      else if (anim === "exit-left") { var k3 = ease((tb - (dur - 0.8)) / 0.8); x = x - (x + cw) * k3; if (k3 > 0) { o.step = 1 + Math.floor(tg * 8) % 2; o.flip = true; } }
      else if (anim === "exit-right") { var k4 = ease((tb - (dur - 0.8)) / 0.8); x = x + (W - x) * k4; if (k4 > 0) o.step = 1 + Math.floor(tg * 8) % 2; }
      else if (anim === "jump") { y -= Math.round(Math.abs(Math.sin(tg * 5)) * 12); o.armsUp = true; }
      else if (anim === "cheer") { o.armsUp = Math.floor(tg * 4) % 2 === 0; y -= o.armsUp ? 2 : 0; }
      else if (anim === "shake") x += Math.round(Math.sin(tg * 45) * 2);
      else if (anim === "spin") o.flip = Math.floor(tg * 6) % 2 === 1;
      else if (anim === "sulk") { y += 2; o.blink = Math.floor(tg * 2) % 2 === 0; o.bob = false; }
      else if (anim === "run") { o.step = 1 + Math.floor(tg * 10) % 2; x += Math.round(Math.sin(tg * 3) * 4); }
      else if (anim === "float") y -= 10 + Math.round(Math.sin(tg * 3 + i) * 4);
      else if (anim === "nod") o.bob = Math.floor(tg * 5) % 2 === 1;
      else if (anim === "faint") { var kf = Math.min(1, tb / 0.5); y += Math.round(kf * 4); o.blink = kf >= 1; x += Math.round(Math.sin(tb * 30) * (1 - kf) * 3); }
      R(ctx, x + 2 * s, ground - 1, 12 * s, 2, "rgba(0,0,0,0.25)");                   // shadow
      drawCharacter(ctx, spec, Math.round(x), Math.round(y), s, o);
      if (a.emote) drawEmote(ctx, a.emote, Math.round(x + cw - 6), Math.round(y - 12), tg + i);
    });

    if (b.sign) {
      var txt = String(b.sign).toUpperCase().slice(0, 18), tw2 = txt.length * 7 + 10, pop = ease(tb / 0.25);
      var bx = Math.round(W / 2 - tw2 / 2), by = Math.round(40 - (1 - pop) * 30);
      R(ctx, bx - 2, by - 2, tw2 + 4, 20, "#1a1c2c"); R(ctx, bx, by, tw2, 16, "#fff4d6"); R(ctx, bx, by + 13, tw2, 3, "#e6cf9a");
      ctx.fillStyle = "#1a1c2c"; ctx.font = "bold 10px monospace"; ctx.textBaseline = "top"; ctx.textAlign = "center";
      ctx.fillText(txt, Math.round(W / 2), by + 3);
    }

    var i2;
    if (fx === "confetti") {
      var cols = ["#e23b6b", "#f6c945", "#4aa8e8", "#5fd38a", "#b47cf0"];
      for (i2 = 0; i2 < 50; i2++) R(ctx, Math.floor(rnd(i2) * W) + Math.round(Math.sin(tg * 3 + i2) * 3), Math.floor((rnd(i2 * 3.3) * FH + tg * (50 + rnd(i2 * 2.1) * 60)) % FH) - top, 2, 3, cols[i2 % 5]);
    } else if (fx === "rain") {
      for (i2 = 0; i2 < 60; i2++) R(ctx, Math.floor(rnd(i2) * W), Math.floor((rnd(i2 * 5.1) * FH + tg * 260) % FH) - top, 1, 5, "rgba(170,205,255,0.7)");
    } else if (fx === "snow") {
      for (i2 = 0; i2 < 40; i2++) R(ctx, Math.floor(rnd(i2) * W + Math.sin(tg + i2) * 4), Math.floor((rnd(i2 * 5.1) * FH + tg * 30) % FH) - top, 2, 2, "#ffffff");
    } else if (fx === "sparkle") {
      for (i2 = 0; i2 < 14; i2++) if (Math.floor(tg * 5 + i2) % 3 === 0) { var spx = Math.floor(rnd(i2 + Math.floor(tg * 2)) * W), spy = Math.floor(rnd(i2 * 2.3 + Math.floor(tg * 2)) * (ground - 20)) + 10; R(ctx, spx, spy - 2, 1, 5, "#fff7c2"); R(ctx, spx - 2, spy, 5, 1, "#fff7c2"); }
    } else if (fx === "dark") {
      R(ctx, -4, -top - 4, W + 8, FH + 8, "rgba(8,10,26,0.55)");
    } else if (fx === "alarm") {
      if (Math.floor(tg * 4) % 2 === 0) R(ctx, -4, -top - 4, W + 8, FH + 8, "rgba(226,59,59,0.28)");
    }
    ctx.restore();
    if (fx === "flash" && tb < 0.25) R(ctx, 0, 0, W, FH, "rgba(255,255,255," + (0.85 * (1 - tb / 0.25)).toFixed(2) + ")");
  }

  return {
    W: W, H: H, WPS: WPS, GAP: GAP, END_HOLD: END_HOLD, MIN_BEAT: MIN_BEAT,
    ACTOR_ANIMS: ACTOR_ANIMS, PROP_ANIMS: PROP_ANIMS, FX: FX, SFX: SFX, EMOTES: EMOTES,
    BACKDROP_OPS: BACKDROP_OPS, HAIR: HAIR, ACCESSORIES: ACCESSORIES, KINDS: KINDS,
    words: words, beatSeconds: beatSeconds, speechSeconds: speechSeconds, timeline: timeline,
    makeLib: makeLib, checkReel: checkReel, checkLibrary: checkLibrary,
    render: render, drawCharacter: drawCharacter, drawProp: drawProp, drawBackdrop: drawBackdrop
  };
});
