/* Vitak Game Vault — app logic
   Reads from Supabase when configured; otherwise renders bundled data.js.
   Edit Mode is gated behind Supabase Auth (magic link). Changes save live
   to the cloud, and can also be exported to a data.js file as a backup. */

(function () {
  "use strict";

  var CATS = [
    { key: "All",    cls: "c-all",    color: "#cbd2ff" },
    { key: "Family", cls: "c-family", color: "#22d3ee" },
    { key: "Kids",   cls: "c-kids",   color: "#a3e635" },
    { key: "Adults", cls: "c-adults", color: "#f472b6" },
    { key: "Heavy",  cls: "c-heavy",  color: "#f59e0b" }
  ];
  var STATUSES = ["Own", "Buy", "Hold", "Research", "Backed", "Pass"];
  var CAT_CLASS = { Family: "c-family", Kids: "c-kids", Adults: "c-adults", Heavy: "c-heavy" };

  // ---- state ----
  var games = [];
  var dirty = {};            // id -> {travel?, status?}
  var view = { cat: "All", q: "", sort: "score-desc", travelOnly: false, players: 0, statuses: {} };
  STATUSES.forEach(function (s) { view.statuses[s] = true; });

  var sb = null, user = null, editing = false;
  var passMode = function () { return !!window.EDIT_PASSPHRASE; };
  var unlocked = false;
  try { unlocked = localStorage.getItem("gv_edit") === "1"; } catch (e) {}

  // parse "2-5 (best 3-4)" / "2 only" / "2-8+ (best 6-8)" -> {min,max}
  function parsePlayers(str) {
    var s = String(str || "");
    var pre = s.split("(")[0];
    var plus = /\+/.test(pre);
    var nums = (pre.match(/\d+/g) || []).map(Number);
    if (!nums.length) return { min: 1, max: 99 }; // unknown -> always matches
    var min = nums[0], max = nums[nums.length - 1];
    if (plus) max = 99;
    return { min: min, max: max };
  }

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove("show"); }, 2600); }

  // ---- boot ----
  function normalize(row) {
    // accept both bundled (camelCase) and supabase (snake_case)
    return {
      id: row.id, name: row.name, status: row.status, category: row.category,
      bestFor: row.bestFor != null ? row.bestFor : row.best_for,
      also: row.also, score: row.score, type: row.type, players: row.players,
      ages: row.ages, time: row.time, weight: row.weight, bgg: row.bgg,
      price: row.price, what: row.what, notes: row.notes, take: row.take,
      bggId: row.bggId != null ? row.bggId : row.bgg_id,
      image: row.image || "",
      travel: !!row.travel,
      _p: parsePlayers(row.players)
    };
  }

  function init() {
    buildCats(); buildStatusFilter(); bindControls();
    var haveSb = window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase;
    if (haveSb) {
      sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      loadFromCloud();
      sb.auth.getUser().then(function (r) { setUser(r && r.data ? r.data.user : null); });
      sb.auth.onAuthStateChange(function (_e, session) { setUser(session ? session.user : null); });
    } else {
      games = (window.GAMES_FALLBACK || []).map(normalize);
      render();
      toast("Demo mode — connect Supabase to save live");
    }
  }

  function loadFromCloud() {
    sb.from("games").select("*").then(function (res) {
      if (res.error || !res.data || !res.data.length) {
        games = (window.GAMES_FALLBACK || []).map(normalize);
        toast("Using bundled data (cloud not seeded yet)");
      } else {
        games = res.data.map(normalize);
      }
      render();
    });
  }

  function setUser(u) {
    user = u;
    if (passMode()) { $("editBtn").style.display = ""; return; } // passphrase mode ignores auth
    var allowed = !u ? false :
      (!window.EDITOR_EMAILS || !window.EDITOR_EMAILS.length ||
        window.EDITOR_EMAILS.map(function (e) { return e.toLowerCase(); }).indexOf((u.email || "").toLowerCase()) > -1);
    $("editBtn").style.display = "";
    if (u && !allowed) toast("That account isn't on the editor list");
    if (editing && !allowed) toggleEdit(false);
    $("editBtn")._allowed = allowed;
  }

  // ---- controls ----
  function buildCats() {
    var el = $("cats"); el.innerHTML = "";
    CATS.forEach(function (c) {
      var b = document.createElement("button");
      b.className = "chip " + c.cls + (view.cat === c.key ? " active " + c.cls : "");
      b.innerHTML = (c.key === "All" ? "" : '<span class="dot" style="background:' + c.color + '"></span>') + c.key;
      b.onclick = function () { view.cat = c.key; buildCats(); render(); };
      el.appendChild(b);
    });
  }
  function buildStatusFilter() {
    var el = $("statusfilter"); el.innerHTML = "";
    var colors = { Own: "#38bdf8", Buy: "#34d399", Hold: "#fb923c", Research: "#facc15", Backed: "#c084fc", Pass: "#7c8099" };
    STATUSES.forEach(function (s) {
      var b = document.createElement("button");
      b.className = "sf" + (view.statuses[s] ? "" : " off");
      b.innerHTML = '<span class="sdot" style="background:' + colors[s] + '"></span>' + s;
      b.onclick = function () { view.statuses[s] = !view.statuses[s]; buildStatusFilter(); render(); };
      el.appendChild(b);
    });
  }
  function bindControls() {
    $("q").oninput = function () { view.q = this.value.toLowerCase(); render(); };
    $("sort").onchange = function () { view.sort = this.value; render(); };
    $("travelBtn").onclick = function () { view.travelOnly = !view.travelOnly; this.classList.toggle("on", view.travelOnly); render(); };
    $("players").oninput = function () {
      view.players = parseInt(this.value, 10) || 0;
      $("pval").textContent = view.players === 0 ? "Any" : (view.players >= 10 ? "10+" : String(view.players));
      $("pclear").hidden = view.players === 0;
      render();
    };
    $("pclear").onclick = function () { view.players = 0; $("players").value = 0; $("pval").textContent = "Any"; this.hidden = true; render(); };
    $("editBtn").onclick = onEditClick;
    $("exportBtn").onclick = exportData;
    $("pushBtn").onclick = pushToCloud;
    $("authX").onclick = function () { $("authModal").classList.remove("show"); };
    $("authSend").onclick = sendMagicLink;
  }

  // ---- filtering / sorting ----
  function num(x) { var m = String(x || "").match(/[\d.]+/); return m ? parseFloat(m[0]) : 0; }
  function visible() {
    var out = games.filter(function (g) {
      if (view.cat !== "All" && g.category !== view.cat) return false;
      if (view.travelOnly && !g.travel) return false;
      if (!view.statuses[g.status]) return false;
      if (view.players > 0) {
        var n = view.players, p = g._p || { min: 1, max: 99 };
        if (n >= 10 ? p.max < 10 : (n < p.min || n > p.max)) return false;
      }
      if (view.q) {
        var hay = (g.name + " " + g.type + " " + g.bestFor + " " + g.what + " " + g.notes + " " + g.also).toLowerCase();
        if (hay.indexOf(view.q) < 0) return false;
      }
      return true;
    });
    var s = view.sort;
    out.sort(function (a, b) {
      if (s === "name") return a.name.localeCompare(b.name);
      if (s === "bgg-desc") return num(b.bgg) - num(a.bgg);
      if (s === "weight-desc") return num(b.weight) - num(a.weight);
      if (s === "weight-asc") return num(a.weight) - num(b.weight);
      var d = (b.score || 0) - (a.score || 0);
      return s === "score-asc" ? -d : d;
    });
    return out;
  }

  // ---- render ----
  function render() {
    var list = visible();
    var grid = $("grid");
    grid.innerHTML = "";
    $("empty").style.display = list.length ? "none" : "block";
    list.forEach(function (g) { grid.appendChild(card(g)); });
    renderStats();
    $("foot").innerHTML = "Showing <b style='color:var(--txt)'>" + list.length + "</b> of " + games.length +
      " games &nbsp;·&nbsp; scores rank each game within its category &nbsp;·&nbsp; a Pass can outscore a Buy on purpose.";
  }

  function renderStats() {
    var counts = {}; STATUSES.forEach(function (s) { counts[s] = 0; });
    var travel = 0;
    games.forEach(function (g) { if (counts[g.status] != null) counts[g.status]++; if (g.travel) travel++; });
    var el = $("stats"); el.innerHTML = "";
    var items = [["Total", games.length]].concat(STATUSES.map(function (s) { return [s, counts[s]]; }));
    items.push(["🧳 Travel", travel]);
    items.forEach(function (p) {
      var d = document.createElement("div"); d.className = "stat";
      d.innerHTML = "<b>" + p[1] + "</b><span>" + p[0] + "</span>";
      el.appendChild(d);
    });
  }

  function card(g) {
    var c = document.createElement("div");
    c.className = "card " + (CAT_CLASS[g.category] || "c-family");
    // trim parentheticals and "/chapter"-style suffixes so each cell stays short
    var sc = function (v) { v = String(v == null ? "" : v).split("(")[0].split(" /")[0].trim(); return v || "–"; };
    var specs = [
      "👥 " + sc(g.players), "⏱ " + sc(g.time), "🎯 " + sc(g.ages),
      "🧠 " + sc(g.weight), "⭐ " + sc(g.bgg), "💲 " + sc(g.price)
    ].map(function (cell) {
      var i = cell.indexOf(" ");
      return '<span class="sp">' + cell.slice(0, i) + " <b>" + esc(cell.slice(i + 1)) + "</b></span>";
    });

    var bggUrl = g.bggId ? "https://boardgamegeek.com/boardgame/" + g.bggId : "";
    var initial = esc((g.name || "?").charAt(0));
    var img = g.image
      ? '<img src="' + esc(g.image) + '" alt="' + esc(g.name) + '" loading="lazy" onerror="this.style.display=\'none\';this.parentNode.querySelector(\'.ph\').style.display=\'flex\'" />'
      : "";

    c.innerHTML =
      '<div class="banner">' +
        img +
        '<div class="ph" style="' + (g.image ? "display:none" : "") + '">' + initial + "</div>" +
        (g.travel ? '<span class="travel-ribbon">🧳 Packed</span>' : "") +
        '<div class="meta">' +
          (g.score != null && g.score !== "" ? '<div class="b-score"><b>' + g.score + "</b><span>SCORE</span></div>" : "") +
          '<span class="pill st-' + esc(g.status) + '">' + esc(g.status) + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="body">' +
        '<div class="title">' + esc(g.name) + "</div>" +
        '<div class="badges"><span class="tag cat">' + esc(g.category) + "</span></div>" +
        '<div class="specs">' + specs.join("") + "</div>" +
        (g.what ? '<div class="what">' + esc(g.what) + "</div>" : "") +
        '<div class="take-wrap">' +
          (g.notes ? '<div class="note">📝 ' + esc(g.notes) + "</div>" : "") +
          (g.take ? '<div class="take"><span class="lbl">Claude\'s Take</span>' + esc(g.take) + "</div>" : "") +
          '<div class="cfoot">' +
            (bggUrl ? '<a class="mini-link" href="' + bggUrl + '" target="_blank" rel="noopener">BGG ↗</a>' : "") +
            (g.take ? '<button class="expand">Claude\'s Take ▾</button>' : "") +
          "</div>" +
        "</div>" +
        editControls(g) +
      "</div>";

    var tk = c.querySelector(".take"), ex = c.querySelector(".expand");
    if (ex) ex.onclick = function () { tk.classList.toggle("open"); ex.textContent = tk.classList.contains("open") ? "Claude's Take ▴" : "Claude's Take ▾"; };
    wireEdit(c, g);
    return c;
  }

  function editControls(g) {
    var opts = STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === g.status ? " selected" : "") + ">" + s + "</option>"; }).join("");
    return '<div class="edit-controls">' +
      '<button class="tv' + (g.travel ? " on" : "") + '" data-tv>🧳 ' + (g.travel ? "Traveling" : "Not packed") + "</button>" +
      '<select data-status>' + opts + "</select>" +
      "</div>";
  }
  function wireEdit(c, g) {
    var tv = c.querySelector("[data-tv]"), sel = c.querySelector("[data-status]");
    if (tv) tv.onclick = function () {
      g.travel = !g.travel; mark(g.id, "travel", g.travel);
      render();
    };
    if (sel) sel.onchange = function () { g.status = this.value; mark(g.id, "status", this.value); render(); };
  }

  function mark(id, field, val) {
    dirty[id] = dirty[id] || {};
    dirty[id][field] = val;
    var n = Object.keys(dirty).length;
    $("savebar").classList.toggle("show", n > 0 && editing);
    $("saveMsg").textContent = n + " game" + (n === 1 ? "" : "s") + " changed";
  }

  // ---- edit mode + auth ----
  function onEditClick() {
    if (editing) { toggleEdit(false); return; }
    if (!sb) { toggleEdit(true); toast("Demo mode: edits stay in this browser"); return; }
    if (passMode()) {
      if (unlocked) { toggleEdit(true); return; }
      var entry = window.prompt("Enter the edit passphrase:");
      if (entry == null) return;
      if (entry === window.EDIT_PASSPHRASE) {
        unlocked = true;
        try { localStorage.setItem("gv_edit", "1"); } catch (e) {}
        toggleEdit(true);
      } else { toast("Wrong passphrase"); }
      return;
    }
    if (!user) { $("authModal").classList.add("show"); return; }
    if ($("editBtn")._allowed === false) { toast("This account can't edit"); return; }
    toggleEdit(true);
  }
  function toggleEdit(on) {
    editing = on;
    document.body.classList.toggle("editing", on);
    $("editBtn").classList.toggle("on", on);
    $("editBtn").querySelector("span").textContent = on ? "Done" : "Edit";
    $("savebar").classList.toggle("show", on && Object.keys(dirty).length > 0);
  }
  function sendMagicLink() {
    var email = ($("authEmail").value || "").trim();
    if (!email) { toast("Enter your email"); return; }
    sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href } }).then(function (r) {
      if (r.error) toast("Error: " + r.error.message);
      else { toast("Magic link sent — check your email"); $("authModal").classList.remove("show"); }
    });
  }

  function pushToCloud() {
    if (!sb) { toast("No cloud connected — use Export instead"); return; }
    if (!passMode() && !user) { $("authModal").classList.add("show"); return; }
    var ids = Object.keys(dirty);
    if (!ids.length) { toast("Nothing to save"); return; }
    var ops = ids.map(function (id) {
      var patch = {}; if ("travel" in dirty[id]) patch.travel = dirty[id].travel; if ("status" in dirty[id]) patch.status = dirty[id].status;
      return sb.from("games").update(patch).eq("id", id);
    });
    Promise.all(ops).then(function (res) {
      var err = res.find(function (r) { return r.error; });
      if (err) { toast("Save failed: " + err.error.message); return; }
      dirty = {}; $("savebar").classList.remove("show"); toast("Saved to cloud ✓");
    });
  }

  // export a fresh data.js as a backup / for committing to the repo
  function exportData() {
    var cols = ["id", "name", "status", "category", "bestFor", "also", "score", "type", "players", "ages", "time", "weight", "bgg", "price", "what", "notes", "take", "bggId", "image", "travel"];
    var clean = games.map(function (g) { var o = {}; cols.forEach(function (k) { o[k] = g[k]; }); return o; });
    var out = "// Bundled fallback data (exported " + new Date().toISOString().slice(0, 10) + ").\n" +
      "window.GAMES_FALLBACK = " + JSON.stringify(clean, null, 1) + ";\n";
    var blob = new Blob([out], { type: "text/javascript" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "data.js"; a.click();
    toast("data.js downloaded — commit it to your repo");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
