/* One Album — one record off your shelf, played through.
   A three-mode listening experiment: shuffle, random album, your crate.
   Everything runs and is stored on the device. No server. */
(() => {
"use strict";

const VERSION = "0.2.0";
const CFG = window.ONE_ALBUM_CONFIG || {};
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const params = new URLSearchParams(location.search);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("oa:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("oa:" + k, JSON.stringify(v)); } catch (e) { console.warn("save failed", e); } },
  del(k) { try { localStorage.removeItem("oa:" + k); } catch {} },
};

const DEFAULT_SETTINGS = { assignment: "random", shuffleMinutes: 45, demo: false, token: "" };
let settings = Object.assign({}, DEFAULT_SETTINGS, store.get("settings", {}));
let sessions = store.get("sessions", []);
let library = store.get("library", { fetchedAt: 0, albums: [] });
const saveSettings = () => store.set("settings", settings);
const saveSessions = () => store.set("sessions", sessions);
const saveLibrary = () => store.set("library", library);

// one random id per install, so pooled exports can be told apart later
let who = store.get("who", null);
if (!who) { who = uid(); store.set("who", who); }
const mine = (s) => (!s.who || s.who === who) && !!s.demo === !!settings.demo;

/* ---------- run: the locked crate plus the mode assignment state ---------- */
// demo and real runs are kept apart so testing never touches the real sequence
const runKey = () => (settings.demo ? "run-demo" : "run");
let run = null;
const loadRun = () => { run = store.get(runKey(), null); };
const saveRun = () => store.set(runKey(), run);
function newRun(crate) {
  run = { id: uid(), startedAt: Date.now(), crate: crate.slice(), block: 0, order: [], pos: 0, pending: null };
  saveRun();
}

/* ---------- modes ---------- */
const MODES = ["shuffle", "album", "crate"];
const MODE_LABEL = { shuffle: "Shuffle", album: "Random album", crate: "Your crate" };
const MODE_SHORT = { shuffle: "SHUFFLE", album: "ALBUM", crate: "CRATE" };
const MIN_CRATE = 8, MAX_CRATE = 10;

// shuffled blocks of 3: every block plays each mode once, in random order.
// An assignment stays pending until it's played, so backing out never re-rolls it.
function nextAssignment() {
  if (settings.assignment !== "random") return { mode: settings.assignment, forced: true, block: null, blockPos: null };
  if (run.pending) return run.pending;
  if (!run.order.length || run.pos >= MODES.length) { run.block++; run.order = shuffle(MODES.slice()); run.pos = 0; }
  run.pending = { mode: run.order[run.pos], forced: false, block: run.block, blockPos: run.pos + 1 };
  run.pos++;
  saveRun();
  return run.pending;
}

/* ---------- moods (context only, never used to pick) ---------- */
const MOODS = {
  happy:     { label: "Happy",     e: "☀" },
  sad:       { label: "Sad",       e: "☂" },
  amped:     { label: "Amped",     e: "⚡" },
  calm:      { label: "Calm",      e: "☾" },
  focused:   { label: "Focused",   e: "◎" },
  nostalgic: { label: "Nostalgic", e: "↺" },
};
const WORDS = {
  happy: ["happy", "good", "great", "sunny", "sun", "party", "celebrat", "joy", "excited", "buzz", "fun", "summer", "dance", "bright"],
  sad: ["sad", "down", "low", "blue", "heartbr", "lonely", "rain", "cry", "grief", "gutted", "upset", "hurt"],
  amped: ["amp", "hype", "gym", "run", "workout", "energy", "angry", "pump", "drive", "fired", "lit", "turn up", "lift"],
  calm: ["calm", "chill", "relax", "tired", "sleep", "slow", "sunday", "quiet", "wind down", "cosy", "cozy", "bath", "evening", "lazy"],
  focused: ["focus", "work", "study", "code", "coding", "writ", "deep", "read", "concentrat", "grind", "admin"],
  nostalgic: ["nostalg", "old", "throwback", "memor", "remember", "childhood", "school", "back in", "retro", "home", "miss"],
};
function moodFromText(t) {
  t = (t || "").toLowerCase();
  let best = "any", bestN = 0;
  for (const [m, ws] of Object.entries(WORDS)) {
    const n = ws.filter((w) => t.includes(w)).length;
    if (n > bestN) { best = m; bestN = n; }
  }
  return best;
}
const moodLabel = (m) => (MOODS[m] ? MOODS[m].label : m === "none" ? "No mood" : "Other");

/* ---------- picking ---------- */
const playable = (a) => (a.trackCount || 0) >= 4;
const byId = (id) => library.albums.find((a) => a.id === id);
const crateAlbums = () => (run ? run.crate.map(byId).filter(Boolean) : []);

// uniform random from the library, leaving out crate albums and recent picks
function pickRandomAlbum() {
  const crate = new Set(run.crate);
  const recent = new Set(sessions.slice(-15).map((s) => s.album && s.album.id).filter(Boolean));
  const tiers = [
    (a) => playable(a) && !crate.has(a.id) && !recent.has(a.id),
    (a) => playable(a) && !crate.has(a.id),
    (a) => playable(a),
    () => true,
  ];
  for (const ok of tiers) {
    const c = library.albums.filter(ok);
    if (c.length) return c[Math.floor(Math.random() * c.length)];
  }
  return null;
}

/* ---------- players ----------
   Both players load a queue first (prepare*) and only start audio in start(),
   which is called straight from the Play tap. iOS blocks audio that doesn't. */
class DemoPlayer {
  constructor() { this.speed = Number(params.get("speed")) || 30; this.listeners = {}; this.queue = []; this.idx = -1; this.t = 0; this.playing = false; this.timer = null; }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, x) { (this.listeners[ev] || []).forEach((f) => f(x)); }
  get authorized() { return true; }
  async authorize() {}
  async signOut() {}
  async fetchAlbums() {
    const g = [["Pop"], ["Hip-Hop/Rap"], ["Jazz"], ["Rock"], ["Alternative"], ["Electronic"], ["R&B/Soul"], ["Reggae"], ["Classical"], ["Singer/Songwriter"], ["Dance"], ["Ambient"]];
    const names = ["Late Bloom", "Concrete Gold", "Blue Hours", "Static Hearts", "Paper Rooms", "Night Bus", "Velvet Weather", "Island Time", "Quiet Engines", "Letters Home", "Floorboards", "Low Tide",
      "Summer Static", "Grey Area", "Slow Burn", "Northern Lights", "Back Roads", "Neon Psalms", "Small Hours", "Open Water", "Kitchen Radio", "First Light", "Overpass", "Heavy Sleep"];
    return names.map((n, i) => ({
      id: "demo-" + i, name: n, artist: DEMO_ARTISTS[i % DEMO_ARTISTS.length],
      genres: g[i % g.length], trackCount: 6 + (i % 7), release: String(1975 + i * 2) + "-01-01", added: "2020-01-01", art: "",
    }));
  }
  async prepareAlbum(album) {
    this._load(Array.from({ length: album.trackCount }, (_, i) => ({ title: `Track ${i + 1}`, artist: album.artist, duration: 150 + Math.floor(Math.random() * 150) })));
  }
  async prepareShuffle(minutes) {
    const q = [];
    for (let sum = 0, i = 1; sum < minutes * 60; i++) {
      const d = 150 + Math.floor(Math.random() * 150);
      q.push({ title: `Shuffle song ${i}`, artist: DEMO_ARTISTS[Math.floor(Math.random() * DEMO_ARTISTS.length)], duration: d });
      sum += d;
    }
    this._load(q);
  }
  _load(q) { this.stop(); this.queue = q; this.idx = 0; this.t = 0; }
  start() { this.play(); }
  info() { const q = this.queue[this.idx]; return q ? { index: this.idx, total: this.queue.length, title: q.title, artist: q.artist } : null; }
  get currentTime() { return this.t; }
  get duration() { const q = this.queue[this.idx]; return q ? q.duration : 0; }
  get isPlaying() { return this.playing; }
  play() {
    this.playing = true; this.emit("state", true);
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.playing) return;
      this.t += 0.25 * this.speed;
      if (this.t >= this.duration) this._next();
    }, 250);
  }
  pause() { this.playing = false; this.emit("state", false); }
  skip() { this._next(); }
  _next() {
    if (this.idx >= this.queue.length - 1) { this.stop(); this.emit("ended"); return; }
    this.idx++; this.t = 0; this.emit("track", this.info());
  }
  stop() { this.playing = false; clearInterval(this.timer); this.emit("state", false); }
}
const DEMO_ARTISTS = ["The Fieldwork", "Ama Rose", "Kofi & The Lows", "Mila Grey", "Harbour", "J. Lune"];

class MusicKitPlayer {
  constructor() { this.speed = 1; this.listeners = {}; this.mk = null; }
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, x) { (this.listeners[ev] || []).forEach((f) => f(x)); }
  async init(token) {
    await new Promise((resolve, reject) => {
      if (window.MusicKit) return resolve();
      document.addEventListener("musickitloaded", () => resolve(), { once: true });
      const s = document.createElement("script");
      s.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
      s.async = true; s.onerror = () => reject(new Error("Couldn't load MusicKit. Are you online?"));
      document.head.appendChild(s);
    });
    await MusicKit.configure({ developerToken: token, app: { name: CFG.appName || "One Album", build: VERSION } });
    this.mk = MusicKit.getInstance();
    const PS = MusicKit.PlaybackStates;
    this.mk.addEventListener("nowPlayingItemDidChange", () => { const i = this.info(); if (i) this.emit("track", i); });
    this.mk.addEventListener("playbackStateDidChange", () => {
      const s = this.mk.playbackState;
      this.emit("state", s === PS.playing);
      const last = this.mk.nowPlayingItemIndex >= this.mk.queue.items.length - 1;
      if (s === PS.completed || ((s === PS.ended || s === PS.stopped) && last && this._startedQueue)) {
        if (this._startedQueue) { this._startedQueue = false; this.emit("ended"); }
      }
    });
  }
  get authorized() { return !!(this.mk && this.mk.isAuthorized); }
  async authorize() { await this.mk.authorize(); }
  async signOut() { try { await this.mk.unauthorize(); } catch {} }
  async fetchAlbums(onProgress) {
    const out = []; let offset = 0;
    for (;;) {
      const r = await this.mk.api.music("/v1/me/library/albums", { limit: 100, offset });
      const d = r.data || {};
      for (const a of d.data || []) {
        const at = a.attributes || {};
        let art = "";
        if (at.artwork && at.artwork.url) art = at.artwork.url.replace("{w}", "600").replace("{h}", "600");
        out.push({ id: a.id, name: at.name || "Untitled", artist: at.artistName || "", genres: at.genreNames || [], trackCount: at.trackCount || 0,
          release: at.releaseDate || "", added: at.dateAdded || "", art });
      }
      onProgress && onProgress(out.length);
      if (!d.next || !(d.data || []).length || out.length > 5000) break;
      offset += d.data.length;
    }
    return out;
  }
  async _randomLibrarySongs() {
    const songs = (r) => ((r.data && r.data.data) || []).map((s) => ({ id: s.id, dur: ((s.attributes && s.attributes.durationInMillis) || 0) / 1000 }));
    const first = await this.mk.api.music("/v1/me/library/songs", { limit: 100, offset: 0 });
    const total = (first.data && first.data.meta && first.data.meta.total) || 100;
    let out = songs(first);
    for (let k = 0; k < 3 && total > 100; k++) {
      const offset = Math.floor(Math.random() * Math.max(1, total - 100));
      try { out = out.concat(songs(await this.mk.api.music("/v1/me/library/songs", { limit: 100, offset }))); } catch {}
    }
    return out;
  }
  async prepareAlbum(album) {
    this._startedQueue = false;
    await this.mk.setQueue({ album: album.id, startPlaying: false });
  }
  async prepareShuffle(minutes) {
    const seen = new Set();
    const pool = shuffle((await this._randomLibrarySongs()).filter((s) => !seen.has(s.id) && seen.add(s.id)));
    const ids = [];
    for (let i = 0, sum = 0; i < pool.length && sum < minutes * 60; i++) { ids.push(pool[i].id); sum += pool[i].dur || 210; }
    if (!ids.length) throw new Error("Couldn't find any songs in your library.");
    this._startedQueue = false;
    await this.mk.setQueue({ songs: ids, startPlaying: false });
  }
  start() { this._startedQueue = true; return this.mk.play(); }
  info() {
    const it = this.mk.nowPlayingItem;
    if (!it) return null;
    return { index: this.mk.nowPlayingItemIndex, total: this.mk.queue.items.length, title: it.title || (it.attributes && it.attributes.name) || "", artist: it.artistName || "" };
  }
  get currentTime() { return this.mk.currentPlaybackTime || 0; }
  get duration() { return this.mk.currentPlaybackDuration || 0; }
  get isPlaying() { return this.mk.playbackState === MusicKit.PlaybackStates.playing; }
  play() { return this.mk.play(); }
  pause() { this.mk.pause(); }
  skip() { this.mk.skipToNextItem(); }
  stop() { this._startedQueue = false; try { this.mk.stop(); } catch {} }
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- screens ---------- */
function show(name) {
  $$(".screen").forEach((s) => (s.hidden = s.id !== "screen-" + name));
  window.scrollTo(0, 0);
  if (name === "stats") renderStats();
  if (name === "settings") renderSettings();
  if (name === "setup") renderSetup();
  if (name === "mood") renderMood();
}
$$("[data-goto]").forEach((b) => b.addEventListener("click", () => show(b.dataset.goto)));

/* ---------- boot ---------- */
let player = null;
const token = () => settings.token || CFG.developerToken || "";

async function boot() {
  $("#app-version").textContent = VERSION;
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  recoverInterrupted();
  if (settings.demo) return startDemo();
  loadRun();
  if (!token()) { $("#connect-msg").textContent = "No Apple Music token set yet. The demo works without one."; $("#btn-connect").disabled = true; return show("connect"); }
  try {
    player = new MusicKitPlayer();
    await player.init(token());
    wirePlayer();
    if (player.authorized) return afterAuth();
  } catch (e) { $("#connect-msg").textContent = e.message || String(e); }
  show("connect");
}

$("#btn-connect").addEventListener("click", async () => {
  try { await player.authorize(); await afterAuth(); }
  catch (e) { $("#connect-msg").textContent = "Couldn't connect: " + (e.message || e); }
});
$("#btn-demo").addEventListener("click", () => { settings.demo = true; saveSettings(); startDemo(); });

async function startDemo() {
  $("#demo-banner").hidden = false;
  loadRun();
  player = new DemoPlayer();
  wirePlayer();
  if (!library.albums.length || !library.albums[0].id.startsWith("demo-")) { library = { fetchedAt: Date.now(), albums: await player.fetchAlbums() }; saveLibrary(); }
  routeHome();
}

async function afterAuth() {
  const stale = !library.albums.length || library.albums[0].id.startsWith("demo-") || Date.now() - library.fetchedAt > 7 * 864e5;
  if (stale) {
    show("connect");
    $("#btn-connect").hidden = $("#btn-demo").hidden = true;
    await refreshLibrary((t) => ($("#connect-msg").textContent = t));
    if (!library.albums.length) { $("#btn-connect").hidden = $("#btn-demo").hidden = false; return; }
  }
  routeHome();
}

async function refreshLibrary(say) {
  say("Reading your library…");
  try {
    const albums = await player.fetchAlbums((n) => say(`Reading your library… ${n} albums`));
    library = { fetchedAt: Date.now(), albums }; saveLibrary();
    say("");
  } catch (e) { say("Couldn't read your library: " + (e.message || e)); }
}

function routeHome() {
  if (!run) return openSetup();
  const due = recallDue();
  if (due) return startRecall(due);
  show("mood");
}

/* ---------- day 0: choose the crate ---------- */
let setupPick = [];
function openSetup() {
  setupPick = (run ? run.crate : settings.crate || []).filter((id) => byId(id));
  $("#setup-search").value = "";
  $("#setup-msg").textContent = "";
  show("setup");
}
function renderSetup() {
  const q = $("#setup-search").value.trim().toLowerCase();
  const set = new Set(setupPick);
  const list = library.albums.filter((a) => !q || (a.name + " " + a.artist).toLowerCase().includes(q))
    .sort((a, b) => (set.has(b.id) - set.has(a.id)) || a.artist.localeCompare(b.artist)).slice(0, 300);
  $("#setup-list").innerHTML = list.map((a) => `<li><label class="${playable(a) ? "" : "off"}">${a.art ? `<img src="${esc(a.art)}" alt="" loading="lazy">` : `<span class="ph"></span>`}
    <span><div class="t">${esc(a.name)}</div><div class="a">${esc(a.artist)}${playable(a) ? "" : " · under 4 tracks"}</div></span>
    <input type="checkbox" data-id="${esc(a.id)}" ${set.has(a.id) ? "checked" : ""} ${playable(a) ? "" : "disabled"}></label></li>`).join("");
  syncSetup();
}
function syncSetup() {
  const n = setupPick.length;
  $("#setup-count").textContent = `${n} of ${MIN_CRATE}–${MAX_CRATE} chosen`;
  $("#btn-lock").disabled = n < MIN_CRATE || n > MAX_CRATE;
  $("#btn-setup-cancel").hidden = !run;
  $("#btn-autopick").hidden = !settings.demo;
}
$("#setup-search").addEventListener("input", renderSetup);
$("#setup-list").addEventListener("change", (e) => {
  const id = e.target.dataset.id; if (!id) return;
  if (e.target.checked && setupPick.length >= MAX_CRATE) {
    e.target.checked = false;
    $("#setup-msg").textContent = `That's ${MAX_CRATE}. Untick one first.`;
    return;
  }
  $("#setup-msg").textContent = "";
  setupPick = e.target.checked ? setupPick.concat(id) : setupPick.filter((x) => x !== id);
  syncSetup();
});
$("#btn-autopick").addEventListener("click", () => {
  setupPick = shuffle(library.albums.filter(playable).map((a) => a.id)).slice(0, MAX_CRATE);
  renderSetup();
});
$("#btn-setup-cancel").addEventListener("click", () => show(run ? "settings" : "connect"));
$("#btn-lock").addEventListener("click", () => {
  const same = run && run.crate.length === setupPick.length && run.crate.every((id) => setupPick.includes(id));
  if (same) return show("mood");
  newRun(setupPick);
  show("rules");
});
$("#btn-rules-start").addEventListener("click", routeHome);

/* ---------- mood (optional) ---------- */
let chosenMood = null;
function renderMood() {
  const wrap = $("#mood-chips");
  if (!wrap.children.length) {
    for (const [k, m] of Object.entries(MOODS)) {
      const b = document.createElement("button");
      b.className = "chip"; b.dataset.mood = k;
      b.innerHTML = `<span class="e">${m.e}</span>${m.label}`;
      b.addEventListener("click", () => { chosenMood = chosenMood === k ? null : k; $("#mood-text").value = ""; syncMood(); });
      wrap.appendChild(b);
    }
  }
  const day = Math.floor((Date.now() - run.startedAt) / 864e5) + 1;
  const n = sessions.filter((s) => s.runId === run.id).length;
  const forced = settings.assignment !== "random" ? ` · test: ${MODE_LABEL[settings.assignment]} only` : "";
  $("#mood-eyebrow").textContent = `Day ${day} · session ${n + 1}${forced}`;
  $("#library-count").textContent = `Crate ${run.crate.length} · library ${library.albums.length}`;
  syncMood();
}
function syncMood() {
  $$(".chip").forEach((b) => b.classList.toggle("on", b.dataset.mood === chosenMood));
  $("#btn-next").disabled = !library.albums.length;
}
$("#mood-text").addEventListener("input", () => { if ($("#mood-text").value.trim()) chosenMood = null; syncMood(); });
$("#mood-text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("#btn-next").disabled) $("#btn-next").click(); });
$("#btn-next").addEventListener("click", openReveal);

/* ---------- reveal the mode, prepare the queue, wait for the Play tap ---------- */
let draft = null, prepSeq = 0;
const MODE_DESC = {
  shuffle: () => `Random songs from your whole library, about ${settings.shuffleMinutes} minutes. Skip whenever you like.`,
  album: () => "One record pulled at random off your shelf. It plays in order, and skip works within the album.",
  crate: () => "Pick one of your albums. It plays in order, and skip works within the album.",
};

function openReveal() {
  const text = $("#mood-text").value.trim();
  const a = nextAssignment();
  draft = { mood: chosenMood || (text ? moodFromText(text) : "none"), moodText: text, mode: a.mode, forced: a.forced,
            block: a.block, blockPos: a.blockPos, album: null, why: "", ready: false };
  $("#reveal-eyebrow").textContent = a.forced ? "Test session · mode forced in settings" : "This session";
  $("#reveal-mode").textContent = MODE_LABEL[a.mode];
  $("#reveal-desc").textContent = MODE_DESC[a.mode]();
  $("#reveal-msg").textContent = "";
  $("#reveal-album").hidden = true;
  $("#reveal-shelf").hidden = a.mode !== "crate";
  show("reveal");
  syncPlay();

  if (a.mode === "album") {
    let album = a.albumId && byId(a.albumId);
    if (!album) { album = pickRandomAlbum(); if (!a.forced && album) { a.albumId = album.id; saveRun(); } }
    if (!album) { $("#reveal-msg").textContent = "No albums found in your library."; return; }
    draft.album = album; draft.why = "a random record off your shelf";
    showRevealAlbum(album);
    prepare(() => player.prepareAlbum(album));
  } else if (a.mode === "shuffle") {
    draft.why = `about ${settings.shuffleMinutes} minutes of random songs from your library`;
    prepare(() => player.prepareShuffle(settings.shuffleMinutes));
  } else {
    renderShelf();
  }
}
function showRevealAlbum(album) {
  $("#reveal-album").hidden = false;
  setArt($("#reveal-art"), album);
  $("#reveal-title").textContent = album.name;
  $("#reveal-artist").textContent = album.artist;
}
function renderShelf() {
  const chosen = draft.album && draft.album.id;
  const albums = crateAlbums();
  $("#reveal-shelf").innerHTML = albums.length ? albums.map((a) => `<button class="shelf-item${a.id === chosen ? " on" : ""}" data-id="${esc(a.id)}">
      <span class="cover"${a.art ? ` style="background-image:url('${esc(a.art)}')"` : ""}>${a.art ? "" : esc(a.name.slice(0, 1))}</span>
      <span class="t">${esc(a.name)}</span><span class="a">${esc(a.artist)}</span></button>`).join("")
    : `<p class="small muted">None of your crate albums are in the library any more. Change your crate in Settings.</p>`;
}
$("#reveal-shelf").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]");
  if (!b || !draft || draft.mode !== "crate") return;
  const album = byId(b.dataset.id); if (!album) return;
  draft.album = album; draft.why = "you chose";
  renderShelf();
  prepare(() => player.prepareAlbum(album));
});
async function prepare(fn) {
  const my = ++prepSeq;
  draft.ready = false; syncPlay();
  $("#reveal-msg").textContent = "Getting it ready…";
  try { await fn(); }
  catch (e) { if (my === prepSeq) $("#reveal-msg").textContent = "Couldn't load it: " + (e.message || e); return; }
  if (my !== prepSeq || !draft) return;
  draft.ready = true;
  $("#reveal-msg").textContent = "";
  syncPlay();
}
function syncPlay() { $("#btn-play").disabled = !(draft && draft.ready); }

$("#btn-play").addEventListener("click", () => {
  if (!draft || !draft.ready) return;
  // start audio first, inside the tap, before anything else
  let started;
  try { started = player.start(); } catch (e) { $("#reveal-msg").textContent = "Couldn't start: " + (e.message || e); return; }
  const d = draft; draft = null;
  startSession(d);
  Promise.resolve(started).catch((e) => { $("#play-msg").textContent = "Playback didn't start (" + (e.message || e) + "). Tap ▶ to try again."; });
});
$("#btn-notnow").addEventListener("click", () => { prepSeq++; draft = null; show("mood"); });

/* ---------- session ---------- */
let S = null; // active session
let tick = { t: 0, wall: 0, idx: -1, dur: 0, timer: null, lastSave: 0, playing: false };

function startSession(d) {
  if (!d.forced) { run.pending = null; saveRun(); }
  const a = d.album;
  S = { id: uid(), who, runId: run.id, mode: d.mode, forced: d.forced, block: d.block, blockPos: d.blockPos,
        mood: d.mood, moodText: d.moodText, startedAt: Date.now(), endedAt: null, outcome: null,
        album: a ? { id: a.id, name: a.name, artist: a.artist, art: a.art, genres: a.genres } : null, why: d.why,
        tracks: [], listenedSec: 0, skips: 0, skipRuns: 0, rating: null, note: "", recall: null,
        crate: run.crate.length, crateAtStart: run.crate.slice(), demo: !!settings.demo };
  $("#mood-text").value = ""; chosenMood = null;
  store.set("active", S);
  clearInterval(tick.timer);
  tick = { t: 0, wall: Date.now(), idx: -1, dur: 0, timer: setInterval(onTick, 1000), lastSave: 0, playing: true };
  renderPlaying();
  show("playing");
  onTrack(player.info());
}

function setArt(el, album) {
  el.style.backgroundImage = album && album.art ? `url("${album.art}")` : "";
  el.textContent = album ? (album.art ? "" : album.name.slice(0, 1)) : "⤨";
}

function renderPlaying() {
  const album = S.album;
  $("#play-mode").textContent = MODE_LABEL[S.mode];
  $("#play-mood").textContent = S.moodText ? ` · “${S.moodText}”` : S.mood !== "none" ? " · " + moodLabel(S.mood) : "";
  $("#play-title").textContent = album ? album.name : "Shuffle";
  $("#play-sub").textContent = album ? album.artist : "Random songs from your library";
  setArt($("#play-art"), album);
  $("#play-why").textContent = album ? `${MODE_LABEL[S.mode]}: ${S.why}` : S.why;
  $("#play-track").textContent = "";
  $("#play-msg").textContent = "";
}

function onTrack(info) {
  if (!S || !info) return;
  if (S.tracks.length && info.index === tick.idx) return; // same track reported twice
  closeTrack(false);
  tick.idx = info.index; tick.t = 0; tick.dur = 0; tick.wall = Date.now();
  S.tracks.push({ title: info.title, artist: info.artist, progress: 0, skipped: false });
  $("#play-track").textContent = info.title + (info.artist && S.mode === "shuffle" ? " — " + info.artist : "");
  $("#play-count").textContent = `${info.index + 1} / ${info.total}`;
}

function wirePlayer() {
  player.on("track", onTrack);
  player.on("state", (playing) => {
    $("#btn-pause").textContent = playing ? "❚❚" : "▶";
    $("#btn-pause").setAttribute("aria-label", playing ? "Pause" : "Play");
    if (playing) $("#play-msg").textContent = "";
  });
  player.on("ended", () => { if (S) endSession("finished"); });
}

// record how far the outgoing track got; a skip is a skip press, or under 90% on a track over 30s
function closeTrack(final) {
  const tr = S && S.tracks[S.tracks.length - 1];
  if (!tr || tr.closed) return;
  // estimate where the track got to: last known position plus time played since (ticks can be throttled in the background)
  const since = tick.playing ? ((Date.now() - tick.wall) / 1000) * player.speed : 0;
  const est = tick.dur ? Math.min(tick.dur, tick.t + since) : 0;
  const p = tick.dur ? est / tick.dur : 0;
  if (p > 0.9 && tick.dur) S.listenedSec += Math.max(0, tick.dur - tick.t); // tail end after last tick
  tr.progress = Math.round(p * 100) / 100;
  tr.closed = true;
  const userSkipped = tick.skipPressed;
  tick.skipPressed = false;
  if (userSkipped || (!final && p < 0.9 && tick.dur > 30)) { tr.skipped = true; S.skips++; }
}

// a skip run is 3 or more skips in a row: the skip-skip-skip pattern
function countSkipRuns(tracks) {
  let runs = 0, streak = 0;
  for (const t of tracks || []) {
    if (t.skipped) { if (++streak === 3) runs++; } else streak = 0;
  }
  return runs;
}

function onTick() {
  if (!S) return;
  const now = Date.now();
  const t = player.currentTime, dur = player.duration;
  const wall = ((now - tick.wall) / 1000) * player.speed;
  const d = t - tick.t;
  if (player.isPlaying && d > 0 && d <= wall * 1.25 + 2) S.listenedSec += d;
  tick.t = t; tick.dur = dur || tick.dur; tick.wall = now; tick.playing = player.isPlaying;
  $("#bar-track").style.width = dur ? Math.min(100, (t / dur) * 100) + "%" : "0";
  $("#play-time").textContent = `${fmtClock(t)} / ${fmtClock(dur)}`;
  if (now - tick.lastSave > 5000) { tick.lastSave = now; S.updatedAt = now; store.set("active", S); }
}

$("#btn-pause").addEventListener("click", () => {
  if (player.isPlaying) return player.pause();
  Promise.resolve(player.play()).catch((e) => { $("#play-msg").textContent = "Couldn't play: " + (e.message || e); });
});
$("#btn-skip").addEventListener("click", () => { if (!S) return; tick.skipPressed = true; player.skip(); });

// hold-to-end
(() => {
  const b = $("#btn-end"); let timer = null;
  const start = (e) => { e.preventDefault(); b.classList.add("holding"); timer = setTimeout(() => { b.classList.remove("holding"); endSession("bailed"); }, 1500); };
  const cancel = () => { b.classList.remove("holding"); clearTimeout(timer); };
  b.addEventListener("pointerdown", start);
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, cancel));
})();

function endSession(outcome) {
  if (!S || S.endedAt) return;
  onTick();
  closeTrack(true); // ending the session isn't a skip of the track that was playing
  clearInterval(tick.timer);
  if (outcome !== "finished") player.stop();
  S.tracks.forEach((t) => delete t.closed);
  S.skipRuns = countSkipRuns(S.tracks);
  S.listenedSec = Math.round(S.listenedSec);
  S.endedAt = Date.now(); S.outcome = outcome;
  sessions.push(S); saveSessions(); store.del("active");
  const done = S;
  S = null;
  openRate(done);
}

// if the app was killed mid-session, keep what we had
function recoverInterrupted() {
  const a = store.get("active", null);
  if (!a) return;
  a.endedAt = a.updatedAt || a.startedAt; a.outcome = "interrupted";
  a.listenedSec = Math.round(a.listenedSec || 0);
  (a.tracks || []).forEach((t) => delete t.closed);
  a.skipRuns = countSkipRuns(a.tracks);
  sessions.push(a); saveSessions(); store.del("active");
}

/* ---------- rate ---------- */
let rating = null;
function openRate(sess) {
  rating = sess;
  const what = sess.album ? `${sess.album.name} · ${sess.album.artist}` : "Shuffle";
  $("#rate-eyebrow").textContent = (sess.outcome === "finished" ? "Finished · " : "Ended early · ") + what;
  $("#rate-note").value = "";
  show("rate");
}
$$("[data-rate]").forEach((b) => b.addEventListener("click", () => {
  if (!rating) return;
  const s = sessions.find((x) => x.id === rating.id);
  s.rating = b.dataset.rate; s.note = $("#rate-note").value.trim();
  saveSessions(); rating = null; show("mood"); // nothing auto-loads: back to the start
}));

/* ---------- recall ---------- */
function recallDue() {
  const now = Date.now();
  // ask about sessions that ended 8h–4 days ago and had at least 5 minutes of listening
  return sessions.slice().reverse().find((s) =>
    mine(s) && !s.forced && !s.recall && s.endedAt &&
    now - s.endedAt > 8 * 3600e3 && now - s.endedAt < 4 * 864e5 && (s.listenedSec || 0) > 300);
}
let recalling = null;
function startRecall(s) {
  recalling = s;
  const d = new Date(s.startedAt), h = d.getHours();
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night";
  const yesterday = new Date().toDateString() === new Date(s.startedAt + 864e5).toDateString();
  const when = yesterday ? (part === "night" ? "last night" : `yesterday ${part}`)
    : `on ${d.toLocaleDateString(undefined, { weekday: "long" })} ${part}`;
  $("#recall-q").textContent = `What did you listen to ${when}?`;
  $("#recall-answer").value = "";
  $("#recall-reveal").hidden = true; $("#btn-reveal").hidden = false;
  show("recall");
}
$("#btn-reveal").addEventListener("click", () => {
  const s = recalling;
  if (s.album) $("#recall-truth").textContent = `${s.album.name} — ${s.album.artist}`;
  else {
    const heard = (s.tracks || []).filter((t) => t.progress >= 0.5).map((t) => t.title + (t.artist ? " (" + t.artist + ")" : ""));
    $("#recall-truth").textContent = "Shuffle: " + (heard.join(", ") || "nothing reached halfway");
  }
  $("#recall-reveal").hidden = false; $("#btn-reveal").hidden = true;
});
$$("[data-recall]").forEach((b) => b.addEventListener("click", () => saveRecall(Number(b.dataset.recall))));
$("#btn-recall-skip").addEventListener("click", () => saveRecall(null));
function saveRecall(score) {
  const s = sessions.find((x) => x.id === recalling.id);
  s.recall = { score, answer: $("#recall-answer").value.trim(), at: Date.now() };
  saveSessions(); recalling = null;
  routeHome();
}

/* ---------- stats ---------- */
let period = "run";
$$("#period-tabs button").forEach((b) => b.addEventListener("click", () => {
  period = b.dataset.period;
  $$("#period-tabs button").forEach((x) => x.classList.toggle("on", x === b));
  renderStats();
}));

// demo, forced and other people's imported sessions never count
function inScope() {
  const real = sessions.filter((s) => mine(s) && !s.forced);
  if (period === "run") return run ? real.filter((s) => s.runId === run.id) : [];
  const days = Number(period);
  return days ? real.filter((s) => s.startedAt > Date.now() - days * 864e5) : real;
}
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const RATE = { yes: 1, sortof: 0.5, no: 0 };
const RECALL_MIN = 3;
function summarize(list) {
  // interrupted sessions count in totals and minutes only
  const complete = list.filter((s) => s.outcome !== "interrupted");
  const rated = complete.filter((s) => s.rating in RATE);
  const recalled = list.filter((s) => s.recall && s.recall.score != null);
  return {
    n: list.length,
    hours: list.reduce((a, s) => a + (s.listenedSec || 0), 0) / 3600,
    minutes: avg(list.map((s) => (s.listenedSec || 0) / 60)),
    skips: avg(list.map((s) => s.skips || 0)),
    skipRuns: avg(list.map((s) => (s.skipRuns != null ? s.skipRuns : countSkipRuns(s.tracks)))),
    played: complete.length ? complete.filter((s) => s.outcome === "finished").length / complete.length : null,
    early: complete.length ? complete.filter((s) => s.outcome === "bailed").length / complete.length : null,
    completeN: complete.length,
    good: avg(rated.map((s) => RATE[s.rating])), goodN: rated.length,
    recall: avg(recalled.map((s) => s.recall.score)), recallN: recalled.length,
  };
}
const pct = (x) => (x == null ? "—" : Math.round(x * 100) + "%");
const num = (x, d = 1) => (x == null ? "—" : x.toFixed(d));
const hrs = (h) => (h < 1 ? Math.round(h * 60) + "m" : h.toFixed(1) + "h");

function computeStats() {
  const list = inScope();
  const by = {};
  for (const m of MODES) by[m] = summarize(list.filter((s) => s.mode === m));
  const all = summarize(list);
  const first = list.length ? Math.min(...list.map((s) => s.startedAt)) : Date.now();
  const spanDays = Math.max(1, Math.ceil((Date.now() - first) / 864e5));
  const recallReady = MODES.every((m) => by[m].recallN >= RECALL_MIN);
  const moods = {};
  for (const s of list) {
    const m = moods[s.mood] || (moods[s.mood] = { n: 0, r: [] });
    m.n++; if (s.rating in RATE && s.outcome !== "interrupted") m.r.push(RATE[s.rating]);
  }
  return { list, by, all, spanDays, recallReady, moods };
}

function renderStats() {
  const st = computeStats(), { by, all } = st;
  $("#stats-headline").innerHTML = `
    <div class="stat wide"><div class="l">Was that a good listen?</div>
      <div class="trio">${MODES.map((m) => `<div><div class="n">${pct(by[m].good)}</div><div class="l">${MODE_LABEL[m]}<br>${by[m].goodN} rated</div></div>`).join("")}</div></div>
    <div class="stat"><div class="n">${hrs(all.hours)}</div><div class="l">listened over ${st.spanDays} day${st.spanDays === 1 ? "" : "s"}</div></div>
    <div class="stat"><div class="n">${all.n}</div><div class="l">sessions · one person</div></div>`;
  const cell = (v, n) => `<td>${v}${n != null ? ` <span class="cnt">${n}</span>` : ""}</td>`;
  const rows = [
    ["Sessions", (x) => cell(x.n)],
    ["Good listen", (x) => cell(pct(x.good), x.goodN)],
    ["Skip runs / session", (x) => cell(num(x.skipRuns), x.n)],
    ["Skips / session", (x) => cell(num(x.skips), x.n)],
    ["Played through", (x) => cell(pct(x.played), x.completeN)],
    ["Ended early", (x) => cell(pct(x.early), x.completeN)],
    ["Minutes / session", (x) => cell(num(x.minutes, 0), x.n)],
    ["Next-day recall", (x) => (st.recallReady ? cell(pct(x.recall), x.recallN) : cell(`${x.recallN}/${RECALL_MIN}`))],
  ];
  $("#stats-table").innerHTML = rows.map(([l, f]) => `<tr><td>${l}</td>${MODES.map((m) => f(by[m])).join("")}</tr>`).join("");
  const moodRows = Object.entries(st.moods).sort((a, b) => b[1].n - a[1].n);
  $("#stats-moods").innerHTML = moodRows.length ? moodRows.map(([m, v]) => {
    const r = avg(v.r);
    return `<div class="mood-row"><span>${esc(moodLabel(m))} <span class="muted">× ${v.n}</span></span><span class="bar"><div style="width:${r == null ? 0 : r * 100}%"></div></span><span class="muted">${r == null ? "—" : pct(r)}</span></div>`;
  }).join("") : `<p class="small muted">No sessions yet.</p>`;
  $("#stats-sessions").innerHTML = st.list.slice().reverse().slice(0, 40).map((s) => {
    const d = new Date(s.startedAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const what = s.album ? esc(s.album.name) : "Shuffle";
    const r = s.rating ? { yes: "✓", sortof: "~", no: "✗" }[s.rating] || "" : "";
    return `<li><span><b>${what}</b><br><span class="muted">${esc(MODE_LABEL[s.mode] || s.mode)} · ${d} · ${esc(moodLabel(s.mood))} · ${esc(s.outcome)}</span></span><span class="muted">${Math.round((Number(s.listenedSec) || 0) / 60)}m · ${Number(s.skips) || 0} skips ${r}</span></li>`;
  }).join("");
  $("#share-preview").hidden = true;
}
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---------- share image ---------- */
$("#btn-share").addEventListener("click", async () => {
  const st = computeStats(), { by, all } = st;
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1350;
  const x = c.getContext("2d");
  const serif = '"Iowan Old Style", Palatino, Georgia, serif', mono = "Menlo, Consolas, monospace", sans = "-apple-system, Segoe UI, sans-serif";
  x.fillStyle = "#141210"; x.fillRect(0, 0, 1080, 1350);
  x.fillStyle = "#e8643c"; x.beginPath(); x.arc(980, 120, 36, 0, Math.PI * 2); x.fill();
  const span = period === "run" ? `${st.spanDays} DAY${st.spanDays === 1 ? "" : "S"}` : period === "0" ? "ALL TIME" : `${period} DAYS`;
  x.fillStyle = "#9a9083"; x.font = `26px ${mono}`;
  x.fillText(`${span} · ${all.n} SESSIONS · ONE PERSON`, 80, 130);
  x.fillStyle = "#f1e9dc"; x.font = `500 84px ${serif}`;
  x.fillText("Was that a", 80, 260);
  x.fillText("good listen?", 80, 350);
  MODES.forEach((m, i) => {
    const cx = 80 + i * 320;
    x.fillStyle = "#9a9083"; x.font = `24px ${mono}`; x.fillText(MODE_LABEL[m].toUpperCase(), cx, 470);
    x.fillStyle = "#f1e9dc"; x.font = `500 110px ${serif}`; x.fillText(pct(by[m].good), cx, 600);
    x.fillStyle = "#9a9083"; x.font = `24px ${mono}`; x.fillText(`${by[m].goodN} rated`, cx, 645);
  });
  const rows = [
    ["Skip runs / session", (s) => num(s.skipRuns)],
    ["Played through", (s) => pct(s.played)],
    ["Minutes / session", (s) => num(s.minutes, 0)],
  ];
  if (st.recallReady) rows.push(["Next-day recall", (s) => pct(s.recall)]);
  const colX = [640, 820, 1000];
  let y = 800;
  x.font = `22px ${mono}`; x.fillStyle = "#9a9083"; x.textAlign = "right";
  MODES.forEach((m, i) => x.fillText(MODE_SHORT[m], colX[i], y - 50));
  for (const [l, f] of rows) {
    x.strokeStyle = "#2e2a25"; x.lineWidth = 2; x.beginPath(); x.moveTo(80, y - 36); x.lineTo(1000, y - 36); x.stroke();
    x.textAlign = "left"; x.fillStyle = "#f1e9dc"; x.font = `34px ${sans}`; x.fillText(l, 80, y + 10);
    x.textAlign = "right"; x.font = `36px ${mono}`;
    MODES.forEach((m, i) => x.fillText(f(by[m]), colX[i], y + 10));
    y += 90;
  }
  x.textAlign = "left"; x.fillStyle = "#9a9083"; x.font = `26px ${mono}`;
  x.fillText(`Sessions: shuffle ${by.shuffle.n} · album ${by.album.n} · crate ${by.crate.n}`, 80, 1250);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const img = $("#share-preview"); img.src = URL.createObjectURL(blob); img.hidden = false;
  await shareOrDownload(new File([blob], "one-album-results.png", { type: "image/png" }));
});

// iOS home-screen apps handle the share sheet better than download links
async function shareOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
}

/* ---------- settings ---------- */
function renderSettings() {
  $$('input[name="assign"]').forEach((r) => (r.checked = r.value === settings.assignment));
  $("#set-shuffle-min").value = settings.shuffleMinutes;
  if (run) {
    const day = Math.floor((Date.now() - run.startedAt) / 864e5) + 1;
    const names = crateAlbums().map((a) => a.name).join(", ");
    $("#crate-summary").textContent = `${run.crate.length} albums · run started ${new Date(run.startedAt).toLocaleDateString()} (day ${day}). ${names}`;
  } else $("#crate-summary").textContent = "No run yet.";
  const ago = library.fetchedAt ? Math.round((Date.now() - library.fetchedAt) / 864e5) : null;
  $("#lib-summary").textContent = `${library.albums.length} albums` + (ago != null ? ` · read ${ago === 0 ? "today" : ago + " days ago"}` : "");
  $("#set-token").value = settings.token || "";
}
$$('input[name="assign"]').forEach((r) => r.addEventListener("change", () => { settings.assignment = r.value; saveSettings(); }));
$("#set-shuffle-min").addEventListener("change", (e) => { settings.shuffleMinutes = Math.max(20, Math.min(90, Number(e.target.value) || 45)); saveSettings(); });
$("#btn-change-crate").addEventListener("click", () => {
  if (run && !confirm("Changing your crate ends this run and starts a new one. Results are kept per run. Continue?")) return;
  openSetup();
});
$("#btn-refresh").addEventListener("click", async () => {
  if (settings.demo) return;
  await refreshLibrary((t) => ($("#lib-summary").textContent = t));
  renderSettings();
});
$("#btn-save-token").addEventListener("click", () => { settings.token = $("#set-token").value.trim(); settings.demo = false; saveSettings(); location.reload(); });
$("#btn-signout").addEventListener("click", async () => {
  if (player) await player.signOut();
  settings.demo = false; saveSettings();
  library = { fetchedAt: 0, albums: [] }; saveLibrary();
  location.reload();
});
$("#btn-export").addEventListener("click", () => {
  const data = { app: "one-album", version: VERSION, exportedAt: new Date().toISOString(), who,
                 settings: Object.assign({}, settings, { token: undefined }), run, sessions };
  const name = `one-album-${new Date().toISOString().slice(0, 10)}.json`;
  shareOrDownload(new File([JSON.stringify(data, null, 2)], name, { type: "application/json" }));
});
$("#file-import").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const ids = new Set(sessions.map((s) => s.id));
    const added = (data.sessions || []).filter((s) => s && s.id && !ids.has(s.id));
    sessions = sessions.concat(added).sort((a, b) => a.startedAt - b.startedAt); saveSessions();
    const theirs = added.filter((s) => s.who && s.who !== who).length;
    alert(`Imported ${added.length} sessions.` + (theirs ? ` ${theirs} are from another device and stay out of your results.` : ""));
  } catch { alert("That file didn't look like a One Album export."); }
  e.target.value = "";
});
$("#btn-reset").addEventListener("click", () => {
  if (!confirm("Delete every session on this device? Export first if you want a copy.")) return;
  sessions = []; saveSessions(); renderSettings();
});

/* ---------- utils ---------- */
function fmtClock(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

boot();
})();
