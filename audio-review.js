/* =========================================================================
   Lisan — Audio Review
   Standalone. No React, no build step, no Tailwind dependency.
   Loaded from index.html; exposes window.LisanAudioReview.open(id, name).
   ========================================================================= */

(function () {
  "use strict";

  var SUPABASE_URL = "https://xgfpnlzbtgiyeruggjxl.supabase.co";
  var SUPABASE_KEY = "sb_publishable_FFlXAiV2CJg5oyW3xfIx4A_T00cWK5O";
  var FN = SUPABASE_URL + "/functions/v1/audio-review";
  var STORE = "lisan.audioReview";

  // Pause lengths, in seconds. Arabic, gap, English, gap, Arabic, gap, next.
  var TIMING = { pauseAfterPrompt: 1.2, pauseAfterAnswer: 0.5, pauseBetweenWords: 2.0 };

  var C = {
    bg: "#020617", panel: "#0f172a", line: "#1e293b", line2: "#334155",
    gold: "#f59e0b", gold2: "#fbbf24", text: "#f5f5f4",
    dim: "#a8a29e", dimmer: "#78716c", good: "#10b981", bad: "#fb7185",
  };

  var AR_FONT = "'Traditional Arabic','Amiri','Scheherazade New',serif";

  // ---------------------------------------------------------------- state

  var root = null, audio = null;
  var student = { id: null, name: "" };
  var vocab = [];             // [{unit, lesson}]
  var review = null;          // last generated review, from the function
  var unit = "", lesson = "";
  var tick = null;

  // ---------------------------------------------------------------- utils

  function el(tag, style, text) {
    var n = document.createElement(tag);
    if (style) n.setAttribute("style", style);
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function mmss(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  // Sorts "Lesson 2" before "Lesson 10", matching the rest of the app.
  function natural(a, b) {
    var re = /(\d+)|(\D+)/g;
    var x = String(a).match(re) || [], y = String(b).match(re) || [];
    while (x.length && y.length) {
      var p = x.shift(), q = y.shift();
      var np = parseInt(p, 10), nq = parseInt(q, 10);
      if (!isNaN(np) && !isNaN(nq)) { if (np !== nq) return np - nq; }
      else if (p !== q) return p < q ? -1 : 1;
    }
    return x.length - y.length;
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ review: review, unit: unit, lesson: lesson }));
    } catch (e) { /* private browsing, no matter */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && d.review && d.review.studentId === student.id) {
        review = d.review; unit = d.unit || ""; lesson = d.lesson || "";
      }
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- data

  function loadVocab() {
    return fetch(
      SUPABASE_URL + "/rest/v1/vocab_items?select=unit,lesson&limit=25000",
      { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } }
    ).then(function (r) { return r.json(); }).then(function (rows) {
      vocab = Array.isArray(rows) ? rows : [];
    });
  }

  function callFn(body) {
    return fetch(FN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
      },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d && d.error ? d.error : "Request failed (" + r.status + ")");
        return d;
      });
    });
  }

  var units = function () {
    var s = {};
    vocab.forEach(function (v) { if (v.unit && v.unit.trim()) s[v.unit.trim()] = 1; });
    return Object.keys(s).sort(natural);
  };

  var lessons = function (u) {
    var s = {};
    vocab.forEach(function (v) {
      if (v.unit && v.unit.trim() === u && v.lesson && v.lesson.trim()) s[v.lesson.trim()] = 1;
    });
    return Object.keys(s).sort(natural);
  };

  var countOf = function (u, l) {
    return vocab.filter(function (v) {
      return v.unit && v.unit.trim() === u && v.lesson && v.lesson.trim() === l;
    }).length;
  };

  // ---------------------------------------------------------------- chrome

  var BTN = "background:" + C.gold + ";color:#0f172a;border:none;border-radius:10px;" +
            "padding:11px 20px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit";
  var GHOST = "background:transparent;color:" + C.dim + ";border:1px solid " + C.line2 + ";" +
              "border-radius:10px;padding:9px 16px;font-size:14px;cursor:pointer;font-family:inherit";
  var CHIP = "border-radius:999px;padding:6px 14px;font-size:14px;cursor:pointer;" +
             "font-family:inherit;background:transparent;border:1px solid " + C.line2 + ";color:" + C.dim;
  var CHIP_ON = "border-radius:999px;padding:6px 14px;font-size:14px;cursor:pointer;" +
                "font-family:inherit;background:" + C.line2 + ";border:1px solid " + C.gold +
                ";color:" + C.gold2;

  function chipRow(items, active, onPick, labelFor) {
    var wrap = el("div", "display:flex;flex-wrap:wrap;gap:8px");
    items.forEach(function (it) {
      var b = el("button", it === active ? CHIP_ON : CHIP, labelFor ? labelFor(it) : it);
      b.onclick = function () { onPick(it); };
      wrap.appendChild(b);
    });
    return wrap;
  }

  function heading(t) {
    return el("p", "font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:" +
                   C.dim + ";margin:0 0 8px", t);
  }

  // ---------------------------------------------------------------- screens

  function render() {
    if (!root) return;
    var body = root.querySelector("#ar-body");
    clear(body);
    body.appendChild(review ? player() : picker());
  }

  function picker() {
    var box = el("div", "display:flex;flex-direction:column;gap:22px");

    var us = units();
    if (!us.length) {
      box.appendChild(el("p", "color:" + C.dim, "Loading word list…"));
      return box;
    }

    var s1 = el("div");
    s1.appendChild(heading("Unit"));
    s1.appendChild(chipRow(us, unit, function (u) { unit = u; lesson = ""; render(); }));
    box.appendChild(s1);

    if (unit) {
      var ls = lessons(unit);
      var s2 = el("div");
      s2.appendChild(heading("Lesson"));
      s2.appendChild(chipRow(ls, lesson, function (l) { lesson = l; render(); },
        function (l) { return l + " · " + countOf(unit, l); }));
      box.appendChild(s2);
    }

    if (unit && lesson) {
      var n = countOf(unit, lesson);
      var mins = Math.round(n * 8.5 / 60);

      var note = el("p", "color:" + C.dimmer + ";font-size:13px;margin:0",
        n + " words · roughly " + (mins < 1 ? "under a minute" : mins + " min") +
        " · Arabic, then English, then Arabic again");
      box.appendChild(note);

      var go = el("button", BTN, "Build audio review");
      var err = el("p", "color:" + C.bad + ";font-size:13px;margin:0;white-space:pre-wrap");

      go.onclick = function () {
        go.disabled = true;
        go.style.opacity = ".5";
        go.textContent = "Building… this can take 20 seconds";
        err.textContent = "";

        callFn({
          studentId: student.id,
          unit: unit,
          lesson: lesson,
          order: "arabic_first",
          pauseAfterPrompt: TIMING.pauseAfterPrompt,
          pauseAfterAnswer: TIMING.pauseAfterAnswer,
          pauseBetweenWords: TIMING.pauseBetweenWords,
        }).then(function (d) {
          review = d; save(); render();
        }).catch(function (e) {
          err.textContent = e.message;
          go.disabled = false;
          go.style.opacity = "1";
          go.textContent = "Build audio review";
        });
      };

      box.appendChild(go);
      box.appendChild(err);
    }

    return box;
  }

  function player() {
    var box = el("div", "display:flex;flex-direction:column;gap:18px");

    box.appendChild(el("p", "color:" + C.dim + ";font-size:13px;margin:0",
      review.unit + " · " + review.lesson + " · " + review.wordCount + " words · " +
      mmss(review.durationMs)));

    // --- current word ---
    var card = el("div", "background:" + C.bg + ";border:1px solid " + C.line +
      ";border-radius:14px;padding:26px 18px;text-align:center;min-height:132px;" +
      "display:flex;flex-direction:column;justify-content:center;gap:8px");
    var arLine = el("div", "font-family:" + AR_FONT + ";font-size:40px;line-height:1.35;" +
      "direction:rtl;color:" + C.text);
    var enLine = el("div", "color:" + C.dim + ";font-size:15px");
    var posLine = el("div", "color:" + C.dimmer + ";font-size:12px");
    card.appendChild(arLine); card.appendChild(enLine); card.appendChild(posLine);
    box.appendChild(card);

    // --- scrubber ---
    var bar = el("div", "height:4px;background:" + C.line + ";border-radius:2px;overflow:hidden");
    var fill = el("div", "height:100%;width:0;background:" + C.gold);
    bar.appendChild(fill);
    var times = el("div", "display:flex;justify-content:space-between;color:" + C.dimmer +
      ";font-size:12px;margin-top:6px");
    var tNow = el("span", "", "0:00"), tEnd = el("span", "", mmss(review.durationMs));
    times.appendChild(tNow); times.appendChild(tEnd);
    var scrub = el("div"); scrub.appendChild(bar); scrub.appendChild(times);
    box.appendChild(scrub);

    // --- transport ---
    var row = el("div", "display:flex;align-items:center;justify-content:center;gap:14px");
    var prev = el("button", GHOST, "◀◀");
    var play = el("button", BTN + ";min-width:104px", "Play");
    var next = el("button", GHOST, "▶▶");
    prev.title = "Previous word"; next.title = "Next word";
    row.appendChild(prev); row.appendChild(play); row.appendChild(next);
    box.appendChild(row);

    // --- secondary actions ---
    var acts = el("div", "display:flex;flex-wrap:wrap;gap:10px;justify-content:center");

    // iOS Safari ignores the download attribute on cross-origin links and
    // navigates to the file instead, which tears down this overlay. Pulling
    // the bytes in first and saving from a blob URL keeps us on the page.
    var dl = el("button", GHOST, "Download for offline");
    dl.onclick = function () {
      var label = dl.textContent;
      dl.disabled = true;
      dl.textContent = "Preparing…";
      fetch(review.url)
        .then(function (r) {
          if (!r.ok) throw new Error("fetch failed");
          return r.blob();
        })
        .then(function (blob) {
          var u = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = u;
          a.download = "lisan-" +
            String(review.lesson || "review").replace(/\W+/g, "-").toLowerCase() + ".mp3";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
          dl.disabled = false;
          dl.textContent = "Saved — check Files";
          setTimeout(function () { dl.textContent = label; }, 4000);
        })
        .catch(function () {
          dl.disabled = false;
          dl.textContent = "Download failed — try again";
          setTimeout(function () { dl.textContent = label; }, 4000);
        });
    };
    acts.appendChild(dl);

    var again = el("button", GHOST, "Pick another lesson");
    again.onclick = function () { stop(); review = null; save(); render(); };
    acts.appendChild(again);

    var end = el("button", GHOST + ";border-color:" + C.bad + ";color:" + C.bad, "End audio review");
    end.onclick = function () {
      if (!confirm("Delete this track from storage? Your word clips are kept, so rebuilding is quick.")) return;
      stop();
      end.textContent = "Deleting…";
      callFn({ action: "end", studentId: student.id }).then(function () {
        review = null; save(); render();
      }).catch(function () { review = null; save(); render(); });
    };
    acts.appendChild(end);
    box.appendChild(acts);

    box.appendChild(el("p", "color:" + C.dimmer + ";font-size:12px;text-align:center;margin:0",
      "Keeps playing with the screen off. Skip buttons move a word at a time."));

    // --- wire up audio ---
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
    }
    if (audio.src !== review.url) audio.src = review.url;

    function wordAt(ms) {
      var w = review.words;
      for (var i = 0; i < w.length; i++) if (ms < w[i].endMs) return i;
      return w.length - 1;
    }

    function paint() {
      var ms = audio.currentTime * 1000;
      var pct = review.durationMs ? Math.min(100, ms / review.durationMs * 100) : 0;
      fill.style.width = pct + "%";
      tNow.textContent = mmss(ms);
      var w = review.words[wordAt(ms)];
      if (w) {
        if (arLine.textContent !== w.arabic) {
          arLine.textContent = w.arabic;
          enLine.textContent = w.english;
          posLine.textContent = (w.partOfSpeech || "") + "  ·  " +
            (wordAt(ms) + 1) + " of " + review.words.length;
          media(w);
        }
      }
      play.textContent = audio.paused ? "Play" : "Pause";
    }

    function jump(delta) {
      var i = wordAt(audio.currentTime * 1000);
      // A tap early in a word means "restart this one", which is what
      // rewind buttons do everywhere else.
      if (delta < 0 && audio.currentTime * 1000 - review.words[i].startMs > 1200) delta = 0;
      var t = Math.min(Math.max(0, i + delta), review.words.length - 1);
      audio.currentTime = review.words[t].startMs / 1000;
      paint();
    }

    play.onclick = function () { audio.paused ? audio.play() : audio.pause(); };
    prev.onclick = function () { jump(-1); };
    next.onclick = function () { jump(1); };

    audio.ontimeupdate = paint;
    audio.onplay = function () { paint(); startTick(); };
    audio.onpause = function () { paint(); stopTick(); };
    audio.onended = function () { paint(); stopTick(); };

    paint();
    return box;
  }

  // ---------------------------------------------------------------- lock screen

  function media(w) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: w.arabic,
        artist: w.english,
        album: "Lisān · " + (review.lesson || ""),
      });
      navigator.mediaSession.setActionHandler("play", function () { audio.play(); });
      navigator.mediaSession.setActionHandler("pause", function () { audio.pause(); });
      navigator.mediaSession.setActionHandler("previoustrack", function () {
        var b = root && root.querySelector("#ar-body");
        if (b) { var btns = b.querySelectorAll("button"); }
        stepFromLockScreen(-1);
      });
      navigator.mediaSession.setActionHandler("nexttrack", function () {
        stepFromLockScreen(1);
      });
    } catch (e) { /* older browsers */ }
  }

  function stepFromLockScreen(delta) {
    if (!review || !audio) return;
    var ms = audio.currentTime * 1000, w = review.words, i = w.length - 1;
    for (var k = 0; k < w.length; k++) if (ms < w[k].endMs) { i = k; break; }
    if (delta < 0 && ms - w[i].startMs > 1200) delta = 0;
    var t = Math.min(Math.max(0, i + delta), w.length - 1);
    audio.currentTime = w[t].startMs / 1000;
  }

  // Some browsers throttle timeupdate when backgrounded; this keeps the
  // on-screen word honest when you look back at the phone.
  function startTick() {
    stopTick();
    tick = setInterval(function () {
      if (audio && !audio.paused) {
        var e = new Event("timeupdate");
        audio.dispatchEvent(e);
      }
    }, 500);
  }
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

  function stop() {
    stopTick();
    if (audio) { audio.pause(); }
  }

  // ---------------------------------------------------------------- shell

  function build() {
    root = el("div",
      "position:fixed;inset:0;z-index:9999;background:" + C.bg + ";overflow-y:auto;" +
      "font-family:ui-sans-serif,system-ui,sans-serif;-webkit-overflow-scrolling:touch");

    var inner = el("div", "max-width:640px;margin:0 auto;padding:22px 18px 60px");

    var head = el("div",
      "display:flex;align-items:center;justify-content:space-between;margin-bottom:22px");
    var title = el("div");
    title.appendChild(el("h2", "font-family:Georgia,serif;font-size:24px;color:" + C.text +
      ";margin:0;letter-spacing:.02em", "Audio review"));
    title.appendChild(el("p", "color:" + C.dimmer + ";font-size:12px;margin:3px 0 0",
      student.name ? "for " + student.name : ""));
    var close = el("button", GHOST, "Close");
    close.onclick = function () { stop(); root.remove(); root = null; };
    head.appendChild(title); head.appendChild(close);

    inner.appendChild(head);
    inner.appendChild(el("div", "", "")).id = "ar-body";
    root.appendChild(inner);
    document.body.appendChild(root);
  }

  // ---------------------------------------------------------------- entry

  window.LisanAudioReview = {
    open: function (id, name) {
      student = { id: id, name: name || "" };
      if (root) root.remove();
      review = null; unit = ""; lesson = "";
      restore();
      build();
      render();
      if (!vocab.length) {
        loadVocab().then(render).catch(function () {
          var b = root && root.querySelector("#ar-body");
          if (b) { clear(b); b.appendChild(el("p", "color:" + C.bad, "Couldn't load the word list.")); }
        });
      }
    },
  };
})();
