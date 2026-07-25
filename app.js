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

  // ---- comments / ratings ----
  var commentsByGame = {};   // id -> [comment,...]
  var ratingByGame = {};     // id -> {avg, count}
  function shortSpec(v) { v = String(v == null ? "" : v).split("(")[0].split(" /")[0].trim(); return v || "–"; }
  function starsHTML(n) { var f = Math.round(n || 0), s = ""; for (var i = 1; i <= 5; i++) s += '<span class="' + (i <= f ? "" : "off") + '">★</span>'; return '<span class="stars">' + s + "</span>"; }
  function fmtDate(d) { try { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return ""; } }
  function fetchComments(cb) {
    if (!sb) { if (cb) cb(); return; }
    sb.from("comments").select("*").order("created_at", { ascending: false }).then(function (res) {
      commentsByGame = {}; ratingByGame = {};
      (res.data || []).forEach(function (c) { (commentsByGame[c.game_id] = commentsByGame[c.game_id] || []).push(c); });
      Object.keys(commentsByGame).forEach(function (gid) {
        var rs = commentsByGame[gid].filter(function (c) { return c.rating; }).map(function (c) { return c.rating; });
        if (rs.length) ratingByGame[gid] = { avg: rs.reduce(function (a, b) { return a + b; }, 0) / rs.length, count: rs.length };
      });
      if (cb) cb();
    });
  }

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

  // ---- share filters via URL ----
  function updateURL() {
    var p = new URLSearchParams();
    if (view.cat !== "All") p.set("cat", view.cat);
    if (view.q) p.set("q", view.q);
    if (view.players > 0) p.set("players", view.players);
    if (view.sort !== "score-desc") p.set("sort", view.sort);
    if (view.travelOnly) p.set("travel", "1");
    var offs = STATUSES.filter(function (s) { return !view.statuses[s]; });
    if (offs.length) p.set("hide", offs.join(","));
    var qs = p.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "")); } catch (e) {}
  }
  function applyViewFromURL() {
    var p = new URLSearchParams(location.search);
    if (p.get("cat")) view.cat = p.get("cat");
    if (p.get("q")) view.q = p.get("q").toLowerCase();
    if (p.get("players")) view.players = parseInt(p.get("players"), 10) || 0;
    if (p.get("sort")) view.sort = p.get("sort");
    if (p.get("travel") === "1") view.travelOnly = true;
    if (p.get("hide")) p.get("hide").split(",").forEach(function (s) { if (s in view.statuses) view.statuses[s] = false; });
    $("q").value = p.get("q") || "";
    $("sort").value = view.sort;
    $("players").value = view.players;
    $("pval").textContent = view.players === 0 ? "Any" : (view.players >= 10 ? "10+" : String(view.players));
    $("pclear").hidden = view.players === 0;
    $("travelBtn").classList.toggle("on", view.travelOnly);
    buildCats(); buildStatusFilter();
  }
  function openQR() {
    updateURL();
    var box = $("qrbox"); box.innerHTML = "";
    if (window.QRCode) new window.QRCode(box, { text: location.href, width: 224, height: 224, correctLevel: window.QRCode.CorrectLevel.M });
    else box.textContent = "QR library didn't load.";
    $("qrLink").textContent = location.href;
    $("qrModal").classList.add("show");
  }

  function init() {
    buildCats(); buildStatusFilter(); bindControls(); applyViewFromURL();
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
      fetchComments(render);
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
    $("qrBtn").onclick = openQR;
    $("qrX").onclick = function () { $("qrModal").classList.remove("show"); };
    $("detailX").onclick = function () { $("detailModal").classList.remove("show"); };
    $("detailModal").onclick = function (e) { if (e.target === this) this.classList.remove("show"); };
    $("qrModal").onclick = function (e) { if (e.target === this) this.classList.remove("show"); };
    $("qrCopy").onclick = function () {
      var t = location.href;
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast("Link copied"); }, function () { toast("Copy failed"); });
      else toast("Copy not supported");
    };
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
    updateURL();
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
            '<button class="mini-link" data-detail>💬 ' + ((commentsByGame[g.id] || []).length || "Rate") + "</button>" +
            (ratingByGame[g.id] ? '<span class="cavg">' + starsHTML(ratingByGame[g.id].avg) + " <b>" + ratingByGame[g.id].avg.toFixed(1) + "</b></span>" : "") +
            (g.take ? '<button class="expand">Claude\'s Take ▾</button>' : "") +
          "</div>" +
        "</div>" +
        editControls(g) +
      "</div>";

    var tk = c.querySelector(".take"), ex = c.querySelector(".expand");
    if (ex) ex.onclick = function (e) { e.stopPropagation(); tk.classList.toggle("open"); ex.textContent = tk.classList.contains("open") ? "Claude's Take ▴" : "Claude's Take ▾"; };
    c.addEventListener("click", function (e) {
      if (e.target.closest("a,select,input,textarea,.edit-controls,.expand,.take")) return;
      openDetail(g);
    });
    wireEdit(c, g);
    return c;
  }

  function editControls(g) {
    var opts = STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === g.status ? " selected" : "") + ">" + s + "</option>"; }).join("");
    return '<div class="edit-controls">' +
      '<button class="tv' + (g.travel ? " on" : "") + '" data-tv>🧳 ' + (g.travel ? "Traveling" : "Not packed") + "</button>" +
      '<select data-status>' + opts + "</select>" +
      '<button class="tv" data-note>📝 ' + (g.notes ? "Edit note" : "Add note") + "</button>" +
      "</div>";
  }
  function wireEdit(c, g) {
    var tv = c.querySelector("[data-tv]"), sel = c.querySelector("[data-status]"), nb = c.querySelector("[data-note]");
    if (tv) tv.onclick = function () {
      g.travel = !g.travel; mark(g.id, "travel", g.travel);
      render();
    };
    if (sel) sel.onchange = function () { g.status = this.value; mark(g.id, "status", this.value); render(); };
    if (nb) nb.onclick = function (e) {
      e.stopPropagation();
      var v = window.prompt("Your note for " + g.name + ":", g.notes || "");
      if (v == null) return;
      g.notes = v.trim(); mark(g.id, "notes", g.notes); render();
    };
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
      var patch = {}; if ("travel" in dirty[id]) patch.travel = dirty[id].travel; if ("status" in dirty[id]) patch.status = dirty[id].status; if ("notes" in dirty[id]) patch.notes = dirty[id].notes;
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

  // ---- detail view + comments ----
  function openDetail(g) {
    var rt = ratingByGame[g.id], cs = commentsByGame[g.id] || [];
    var specs = [["👥", g.players], ["⏱", g.time], ["🎯", g.ages], ["🧠", g.weight], ["⭐", g.bgg], ["💲", g.price]]
      .map(function (p) { return '<span class="sp">' + p[0] + " <b>" + esc(shortSpec(p[1])) + "</b></span>"; }).join("");
    var bggUrl = g.bggId ? "https://boardgamegeek.com/boardgame/" + g.bggId : "";
    var img = g.image ? '<img src="' + esc(g.image) + '" alt="" />' : "";

    var commList = cs.length ? cs.map(function (c) {
      return '<div class="cmt"><div class="m"><span class="who">' + esc(c.name || "Anonymous") + "</span>" +
        (c.rating ? starsHTML(c.rating) : "") + '<span style="margin-left:auto">' + fmtDate(c.created_at) + "</span></div>" +
        '<div class="bd">' + esc(c.comment || "") + "</div></div>";
    }).join("") : '<div style="color:var(--muted);font-size:13px;margin-bottom:8px">No ratings yet — be the first.</div>';

    var canPost = !!sb;
    var form = canPost ?
      '<div class="cform">' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:5px">Your rating</div>' +
        '<div class="starpick" id="starpick" data-rating="0">' + [1,2,3,4,5].map(function (i) { return '<span data-v="' + i + '">★</span>'; }).join("") + "</div>" +
        '<input id="cName" type="text" maxlength="60" placeholder="Your name (optional)" />' +
        '<textarea id="cText" maxlength="2000" placeholder="Add a comment…"></textarea>' +
        '<input class="hp" id="cHp" tabindex="-1" autocomplete="off" placeholder="Leave blank" />' +
        '<button class="btn on" id="cPost" style="width:100%;justify-content:center">Post</button>' +
      "</div>"
      : '<div style="color:var(--muted);font-size:13px">Comments are available on the live site.</div>';

    $("detailContent").innerHTML =
      '<div class="d-hero">' + img +
        "<div><div class='d-title'>" + esc(g.name) + "</div>" +
          '<div class="d-badges"><span class="tag cat c-' + (g.category || "").toLowerCase() + '">' + esc(g.category) + "</span>" +
            '<span class="pill st-' + esc(g.status) + '">' + esc(g.status) + "</span>" +
            (g.score != null && g.score !== "" ? '<span class="tag">Score ' + g.score + "</span>" : "") + "</div>" +
        "</div></div>" +
      '<div class="d-specs">' + specs + "</div>" +
      (g.what ? '<div class="d-what">' + esc(g.what) + "</div>" : "") +
      (g.notes ? '<div class="d-note">📝 ' + esc(g.notes) + "</div>" : "") +
      (g.take ? '<div class="d-take"><span class="lbl">Claude\'s Take</span>' + esc(g.take) + "</div>" : "") +
      (bggUrl ? '<div style="margin-top:8px"><a class="mini-link" href="' + bggUrl + '" target="_blank" rel="noopener">View on BoardGameGeek ↗</a></div>' : "") +
      '<div class="d-sec"><h4>Community ratings</h4>' +
        (rt ? '<div class="commrow"><span class="big">' + rt.avg.toFixed(1) + "</span>" + starsHTML(rt.avg) + '<span class="cnt">' + rt.count + " rating" + (rt.count === 1 ? "" : "s") + "</span></div>" : "") +
        commList +
      "</div>" +
      '<div class="d-sec"><h4>Add yours</h4>' + form + "</div>";

    if (canPost) {
      var pick = $("starpick");
      pick.querySelectorAll("span").forEach(function (sp) {
        sp.onclick = function () {
          var v = +sp.getAttribute("data-v"); pick.setAttribute("data-rating", v);
          pick.querySelectorAll("span").forEach(function (s2) { s2.classList.toggle("on", +s2.getAttribute("data-v") <= v); });
        };
      });
      $("cPost").onclick = function () { postComment(g); };
    }
    $("detailModal").classList.add("show");
  }

  function postComment(g) {
    if (($("cHp").value || "").trim() !== "") { $("detailModal").classList.remove("show"); return; } // honeypot tripped
    var comment = ($("cText").value || "").trim();
    var rating = parseInt($("starpick").getAttribute("data-rating"), 10) || null;
    if (!comment && !rating) { toast("Add a rating or a comment"); return; }
    var row = { game_id: g.id, name: ($("cName").value || "").trim() || null, rating: rating, comment: comment || null, hp: "" };
    $("cPost").disabled = true;
    sb.from("comments").insert(row).then(function (res) {
      $("cPost").disabled = false;
      if (res.error) { toast("Post failed: " + res.error.message); return; }
      toast("Thanks — posted!");
      fetchComments(function () { render(); openDetail(g); });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
