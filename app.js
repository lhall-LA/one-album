/* One Album — mood in, one album out, play it through.
   Everything runs and is stored on the device. No server. */
(() => {
"use strict";

const VERSION = "0.1.0";
const CFG = window.ONE_ALBUM_CONFIG || {};
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("oa:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("oa:" + k, JSON.stringify(v)); } catch (e) { console.warn("save failed", e); } },
  del(k) { try { localStorage.removeItem("oa:" + k); } catch {} },
};

const DEFAULT_SETTINGS = { assignment: "random", shuffleLength: 15, crate: [], demo: false, token: "" };
let settings = Object.assign({}, DEFAULT_SETTINGS, store.get("settings", {}));
let sessions = store.get("sessions", []);
let library = store.get("library", { fetchedAt: 0, albums: [] });
const saveSettings = () => store.set("settings", settings);
const saveSessions = () => store.set("sessions", sessions);
const saveLibrary = () => store.set("library", library);

/* ---------- moods ---------- */
const MOODS = {
  happy:     { label: "Happy",     e: "☀", genres: ["pop", "funk", "disco", "reggae", "afro", "soul", "motown", "k-pop", "latin", "dance", "dancehall", "gospel", "r&b"] },
  sad:       { label: "Sad",       e: "☂", genres: ["blues", "singer/songwriter", "alternative", "indie", "folk", "soul", "r&b", "emo", "country"] },
  amped:     { label: "Amped",     e: "⚡", genres: ["hip-hop", "rap", "rock", "metal", "punk", "electronic", "dance", "grime", "drill", "house", "techno", "drum", "dubstep", "garage", "dancehall"] },
  calm:      { label: "Calm",      e: "☾", genres: ["ambient", "jazz", "classical", "folk", "acoustic", "new age", "singer/songwriter", "lo-fi", "chill", "easy listening", "reggae", "neo-soul"] },
  focused:   { label: "Focused",   e: "◎", genres: ["classical", "ambient", "electronic", "jazz", "instrumental", "soundtrack", "post-rock", "lo-fi", "piano", "minimal"] },
  nostalgic: { label: "Nostalgic", e: "↺", genres: [], prefersOld: true },
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
const moodLabel = (m) => (MOODS[m] ? MOODS[m].label : "Any");

/* ---------- picking ---------- */
function genreHit(album, keys) {
  for (const g of album.genres || []) {
    const lg = g.toLowerCase();
    if (lg === "music") continue;
    for (const k of keys) if (lg.includes(k)) return g;
  }
  return null;
}
function weightedPick(items) {
  const total = items.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const x of items) { r -= x.w; if (r <= 0) return x; }
  return items[items.length - 1];
}
function pool() {
  const all = library.albums;
  if (!settings.crate.length) return all;
  const set = new Set(settings.crate);
  const c = all.filter((a) => set.has(a.id));
  return c.length ? c : all;
}
function pickAlbum(mood) {
  let albums = pool();
  const full = albums.filter((a) => (a.trackCount || 0) >= 4);
  if (full.length) albums = full;
  if (!albums.length) return null;
  const recent = new Set(sessions.slice(-15).map((s) => s.album && s.album.id).filter(Boolean));
  const m = MOODS[mood];
  let oldCut = null;
  if (m && m.prefersOld) {
    const dates = albums.map((a) => a.release || a.added || "").filter(Boolean).sort();
    oldCut = dates[Math.floor(dates.length / 3)] || null;
  }
  const scored = albums.map((a) => {
    let w = 1, why = "a wildcard from your library";
    if (m && m.genres.length) { const g = genreHit(a, m.genres); if (g) { w += 5; why = `${m.label.toLowerCase()} → ${g}`; } }
    if (oldCut && (a.release || a.added || "9") <= oldCut) { w += 5; why = "an older one from your shelf"; }
    if (recent.has(a.id)) w *= 0.05;
    return { a, w, why };
  });
  const p = weightedPick(scored);
  return { album: p.a, why: p.why };
}

/* ---------- players ---------- */
class DemoPlayer {
  constructor() { this.speed = 30; this.listeners = {}; this.queue = []; this.idx = -1; this.t = 0; this.playing = false; this.timer = null; }
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
      id: "demo-" + i, name: n, artist: ["The Fieldwork", "Ama Rose", "Kofi & The Lows", "Mila Grey", "Harbour", "J. Lune"][i % 6],
      genres: g[i % g.length], trackCount: 6 + (i % 7), release: String(1975 + i * 2) + "-01-01", added: "2020-01-01", art: "",
    }));
  }
  _tracks(n, prefix) { return Array.from({ length: n }, (_, i) => ({ title: `${prefix} ${i + 1}`, artist: "", duration: 150 + Math.floor(Math.random() * 150) })); }
  async playAlbum(album) { this._start(this._tracks(album.trackCount, "Track")); }
  async playShuffle(n) { this._start(this._tracks(n, "Shuffle song")); }
  _start(q) { this.queue = q; this.idx = 0; this.t = 0; this.play(); this.emit("track", this.info()); }
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
      if (this.t >= this.duration) this._next(true);
    }, 250);
  }
  pause() { this.playing = false; this.emit("state", false); }
  skip() { this._next(false); }
  _next() {
    if (this.idx >= this.queue.length - 1) { this.stop(); this.emit("ended"); return; }
    this.idx++; this.t = 0; this.emit("track", this.info());
  }
  stop() { this.playing = false; clearInterval(this.timer); this.emit("state", false); }
}

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
      s.async = true; s.onerror = () => reject(new Error("Couldn't load MusicKit — are you online?"));
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
  async _songsFromAlbums(ids) {
    const songs = [];
    for (const id of ids) {
      try {
        const r = await this.mk.api.music(`/v1/me/library/albums/${id}/tracks`, { limit: 100 });
        for (const t of (r.data && r.data.data) || []) songs.push(t.id);
      } catch (e) { console.warn(e); }
    }
    return songs;
  }
  async _randomLibrarySongs(n) {
    const first = await this.mk.api.music("/v1/me/library/songs", { limit: 100, offset: 0 });
    const total = (first.data && first.data.meta && first.data.meta.total) || 100;
    let ids = ((first.data && first.data.data) || []).map((s) => s.id);
    for (let k = 0; k < 3 && total > 100; k++) {
      const offset = Math.floor(Math.random() * Math.max(1, total - 100));
      try { const r = await this.mk.api.music("/v1/me/library/songs", { limit: 100, offset }); ids = ids.concat(((r.data && r.data.data) || []).map((s) => s.id)); } catch {}
    }
    return ids;
  }
  async playAlbum(album) {
    this._startedQueue = true;
    await this.mk.setQueue({ album: album.id, startPlaying: true });
  }
  async playShuffle(n, crateIds) {
    let ids = crateIds && crateIds.length ? await this._songsFromAlbums(crateIds) : await this._randomLibrarySongs(n);
    ids = shuffle(Array.from(new Set(ids))).slice(0, n);
    if (!ids.length) throw new Error("Couldn't find any songs in your library.");
    this._startedQueue = true;
    await this.mk.setQueue({ songs: ids, startPlaying: true });
  }
  info() {
    const it = this.mk.nowPlayingItem;
    if (!it) return null;
    return { index: this.mk.nowPlayingItemIndex, total: this.mk.queue.items.length, title: it.title || (it.attributes && it.attributes.name) || "", artist: it.artistName || "" };
  }
  get currentTime() { return this.mk.currentPlaybackTime || 0; }
  get duration() { return this.mk.currentPlaybackDuration || 0; }
  get isPlaying() { return this.mk.playbackState === MusicKit.PlaybackStates.playing; }
  play() { this.mk.play(); }
  pause() { this.mk.pause(); }
  skip() { this.mk.skipToNextItem(); }
  stop() { this._startedQueue = false; try { this.mk.stop(); } catch {} }
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- screens ---------- */
let current = null;
function show(name) {
  $$(".screen").forEach((s) => (s.hidden = s.id !== "screen-" + name));
  current = name;
  window.scrollTo(0, 0);
  if (name === "stats") renderStats();
  if (name === "settings") renderSettings();
  if (name === "crate") renderCrate();
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
  if (!token()) { $("#connect-msg").textContent = "No Apple Music token set yet — the demo works without one."; $("#btn-connect").disabled = true; return show("connect"); }
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
  player = new DemoPlayer();
  wirePlayer();
  if (!library.albums.length || !library.albums[0].id.startsWith("demo-")) { library = { fetchedAt: Date.now(), albums: await player.fetchAlbums() }; saveLibrary(); }
  routeHome();
}

async function afterAuth() {
  const stale = !library.albums.length || library.albums[0].id.startsWith("demo-") || Date.now() - library.fetchedAt > 7 * 864e5;
  if (stale) await refreshLibrary();
  routeHome();
}

async function refreshLibrary() {
  show("mood");
  const msg = $("#mood-msg");
  msg.textContent = "Reading your library…";
  try {
    const albums = await player.fetchAlbums((n) => (msg.textContent = `Reading your library… ${n} albums`));
    library = { fetchedAt: Date.now(), albums }; saveLibrary();
    msg.textContent = "";
  } catch (e) { msg.textContent = "Couldn't read your library: " + (e.message || e); }
  renderMood();
}

function routeHome() {
  const due = recallDue();
  if (due) return startRecall(due);
  show("mood");
}

/* ---------- mood screen ---------- */
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
  const n = library.albums.length, c = settings.crate.length;
  $("#library-count").textContent = c ? `Crate · ${c} albums` : `${n} albums`;
  const label = { random: "Experiment · random mode", album: "One album mode", shuffle: "Shuffle mode" }[settings.assignment];
  $("#mood-eyebrow").textContent = `${label} · session ${sessions.length + 1}`;
  syncMood();
}
function syncMood() {
  $$(".chip").forEach((b) => b.classList.toggle("on", b.dataset.mood === chosenMood));
  $("#btn-go").disabled = !(chosenMood || $("#mood-text").value.trim()) || !library.albums.length;
}
$("#mood-text").addEventListener("input", () => { if ($("#mood-text").value.trim()) chosenMood = null; syncMood(); });
$("#mood-text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("#btn-go").disabled) $("#btn-go").click(); });
$("#btn-go").addEventListener("click", startSession);

function assignMode() {
  if (settings.assignment !== "random") return settings.assignment;
  const week = sessions.filter((s) => s.startedAt > Date.now() - 7 * 864e5);
  const a = week.filter((s) => s.mode === "album").length, b = week.filter((s) => s.mode === "shuffle").length;
  if (a !== b) return a < b ? "album" : "shuffle";
  return Math.random() < 0.5 ? "album" : "shuffle";
}

/* ---------- session ---------- */
let S = null; // active session
let tick = { t: 0, wall: 0, idx: -1, dur: 0, timer: null, lastSave: 0 };

async function startSession() {
  const text = $("#mood-text").value.trim();
  const mood = chosenMood || moodFromText(text);
  const mode = assignMode();
  $("#btn-go").disabled = true;
  $("#mood-msg").textContent = "Picking…";
  S = { id: Date.now().toString(36), mode, mood, moodText: text, startedAt: Date.now(), endedAt: null, outcome: null,
        album: null, why: "", tracks: [], listenedSec: 0, skips: 0, rating: null, note: "", recall: null,
        crate: settings.crate.length, demo: !!settings.demo };
  try {
    if (mode === "album") {
      const p = pickAlbum(mood);
      if (!p) throw new Error("No albums found.");
      S.album = { id: p.album.id, name: p.album.name, artist: p.album.artist, art: p.album.art, genres: p.album.genres };
      S.why = p.why;
      await player.playAlbum(p.album);
    } else {
      S.why = `${settings.shuffleLength} random songs from ${settings.crate.length ? "your crate" : "your library"}`;
      await player.playShuffle(settings.shuffleLength, settings.crate);
    }
  } catch (e) {
    $("#mood-msg").textContent = "Couldn't start: " + (e.message || e);
    S = null; syncMood(); return;
  }
  $("#mood-msg").textContent = "";
  $("#mood-text").value = ""; chosenMood = null;
  store.set("active", S);
  renderPlaying();
  show("playing");
  tick = { t: 0, wall: Date.now(), idx: -1, dur: 0, timer: setInterval(onTick, 1000), lastSave: 0 };
}

function renderPlaying() {
  const album = S.mode === "album";
  $("#play-mode").textContent = album ? "One album" : "Shuffle";
  $("#play-mood").textContent = S.moodText ? `“${S.moodText}”` : moodLabel(S.mood);
  $("#play-title").textContent = album ? S.album.name : "Shuffle";
  $("#play-sub").textContent = album ? S.album.artist : "Skip whenever you like";
  const art = $("#play-art");
  art.style.backgroundImage = album && S.album.art ? `url("${S.album.art}")` : "";
  art.textContent = album && S.album.art ? "" : album ? S.album.name.slice(0, 1) : "⤨";
  $("#btn-skip").hidden = album;
  $("#play-why").textContent = album ? `Picked: ${S.why}` : S.why;
  $("#play-track").textContent = "";
}

function wirePlayer() {
  player.on("track", (info) => {
    if (!S) return;
    closeTrack(false);
    tick.idx = info.index; tick.t = 0; tick.wall = Date.now();
    S.tracks.push({ title: info.title, artist: info.artist, progress: 0, skipped: false });
    $("#play-track").textContent = info.title + (info.artist && S.mode === "shuffle" ? " — " + info.artist : "");
    $("#play-count").textContent = `${info.index + 1} / ${info.total}`;
  });
  player.on("state", (playing) => { $("#btn-pause").textContent = playing ? "❚❚" : "▶"; $("#btn-pause").setAttribute("aria-label", playing ? "Pause" : "Play"); });
  player.on("ended", () => { if (S) endSession("finished"); });
}

// record how far the outgoing track got; under 90% counts as a skip
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
  if (!final && (userSkipped || (p < 0.9 && tick.dur > 30))) { tr.skipped = true; S.skips++; }
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

$("#btn-pause").addEventListener("click", () => (player.isPlaying ? player.pause() : player.play()));
$("#btn-skip").addEventListener("click", () => { tick.skipPressed = true; player.skip(); });

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
  closeTrack(outcome === "finished");
  clearInterval(tick.timer);
  if (outcome !== "finished") player.stop();
  S.tracks.forEach((t) => delete t.closed);
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
  sessions.push(a); saveSessions(); store.del("active");
}

/* ---------- rate ---------- */
let rating = null;
function openRate(sess) {
  rating = sess;
  const what = sess.mode === "album" ? `${sess.album.name} · ${sess.album.artist}` : "Shuffle session";
  $("#rate-eyebrow").textContent = (sess.outcome === "finished" ? "Finished · " : "Ended early · ") + what;
  $("#rate-note").value = "";
  show("rate");
}
$$("[data-rate]").forEach((b) => b.addEventListener("click", () => {
  if (!rating) return;
  const s = sessions.find((x) => x.id === rating.id);
  s.rating = b.dataset.rate; s.note = $("#rate-note").value.trim();
  saveSessions(); rating = null; show("mood");
}));

/* ---------- recall ---------- */
function recallDue() {
  const now = Date.now();
  // ask about sessions that ended 8h–4 days ago and had at least 5 minutes of listening
  return sessions.slice().reverse().find((s) =>
    !s.recall && s.endedAt && !!s.demo === !!settings.demo &&
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
  if (s.mode === "album") $("#recall-truth").textContent = `${s.album.name} — ${s.album.artist}`;
  else {
    const top = s.tracks.filter((t) => !t.skipped).slice(0, 4).map((t) => t.title + (t.artist ? " (" + t.artist + ")" : ""));
    $("#recall-truth").textContent = "Shuffle: " + (top.join(", ") || "nothing finished");
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
let period = 7;
$$("#period-tabs button").forEach((b) => b.addEventListener("click", () => {
  period = Number(b.dataset.period);
  $$("#period-tabs button").forEach((x) => x.classList.toggle("on", x === b));
  renderStats();
}));

function inPeriod() {
  const real = sessions.filter((s) => !!s.demo === !!settings.demo);
  if (!period) return real;
  return real.filter((s) => s.startedAt > Date.now() - period * 864e5);
}
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const RATE = { yes: 1, sortof: 0.5, no: 0 };
function summarize(list) {
  const rated = list.filter((s) => s.rating), recalled = list.filter((s) => s.recall && s.recall.score != null);
  return {
    n: list.length,
    hours: list.reduce((a, s) => a + (s.listenedSec || 0), 0) / 3600,
    skips: avg(list.map((s) => s.skips || 0)),
    finished: list.length ? list.filter((s) => s.outcome === "finished").length / list.length : null,
    worked: rated.length ? avg(rated.map((s) => RATE[s.rating])) : null,
    recall: recalled.length ? avg(recalled.map((s) => s.recall.score)) : null,
    recallN: recalled.length,
  };
}
const pct = (x) => (x == null ? "—" : Math.round(x * 100) + "%");
const num = (x, d = 1) => (x == null ? "—" : x.toFixed(d));
const hrs = (h) => (h < 1 ? Math.round(h * 60) + "m" : h.toFixed(1) + "h");

function computeStats() {
  const list = inPeriod();
  const all = summarize(list);
  const A = summarize(list.filter((s) => s.mode === "album"));
  const B = summarize(list.filter((s) => s.mode === "shuffle"));
  const first = list.length ? Math.min(...list.map((s) => s.startedAt)) : Date.now();
  const days = period || Math.max(1, Math.ceil((Date.now() - first) / 864e5));
  const spanDays = Math.max(1, Math.min(days, Math.ceil((Date.now() - first) / 864e5)));
  const moods = {};
  for (const s of list) {
    const m = moods[s.mood] || (moods[s.mood] = { n: 0, r: [] });
    m.n++; if (s.rating) m.r.push(RATE[s.rating]);
  }
  const finishedAlbums = list.filter((s) => s.mode === "album" && s.outcome === "finished").length;
  return { list, all, A, B, perDay: all.hours / spanDays, finishedAlbums, moods };
}

function renderStats() {
  const st = computeStats(), { all, A, B } = st;
  $("#stats-headline").innerHTML = `
    <div class="stat wide"><div class="n">${pct(A.recall)} <span class="muted">vs</span> ${pct(B.recall)}</div><div class="l">next-day recall · one album vs shuffle</div></div>
    <div class="stat"><div class="n">${hrs(all.hours)}</div><div class="l">listened · ${hrs(st.perDay)} a day</div></div>
    <div class="stat"><div class="n">${st.finishedAlbums}</div><div class="l">albums played through</div></div>`;
  const rows = [
    ["Sessions", A.n, B.n, null],
    ["Hours", hrs(A.hours), hrs(B.hours), null],
    ["Skips / session", num(A.skips), num(B.skips), "low"],
    ["Played through", pct(A.finished), pct(B.finished), "high"],
    ["It worked", pct(A.worked), pct(B.worked), "high"],
    ["Next-day recall", pct(A.recall), pct(B.recall), "high"],
  ];
  const raw = { "Skips / session": [A.skips, B.skips], "Played through": [A.finished, B.finished], "It worked": [A.worked, B.worked], "Next-day recall": [A.recall, B.recall] };
  $("#stats-table").innerHTML = rows.map(([l, a, b, better]) => {
    let wa = "", wb = "";
    if (better && raw[l][0] != null && raw[l][1] != null && raw[l][0] !== raw[l][1]) {
      const aWins = better === "high" ? raw[l][0] > raw[l][1] : raw[l][0] < raw[l][1];
      wa = aWins ? "win" : ""; wb = aWins ? "" : "win";
    }
    return `<tr><td>${l}</td><td class="${wa}">${a}</td><td class="${wb}">${b}</td></tr>`;
  }).join("");
  const moodRows = Object.entries(st.moods).sort((a, b) => b[1].n - a[1].n);
  $("#stats-moods").innerHTML = moodRows.length ? moodRows.map(([m, v]) => {
    const r = avg(v.r);
    return `<div class="mood-row"><span>${moodLabel(m)} <span class="muted">× ${v.n}</span></span><span class="bar"><div style="width:${r == null ? 0 : r * 100}%"></div></span><span class="muted">${r == null ? "—" : pct(r) + " worked"}</span></div>`;
  }).join("") : `<p class="small muted">No sessions yet.</p>`;
  $("#stats-sessions").innerHTML = st.list.slice().reverse().slice(0, 40).map((s) => {
    const d = new Date(s.startedAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const what = s.mode === "album" ? esc(s.album.name) : "Shuffle";
    const r = s.rating ? { yes: "✓", sortof: "~", no: "✗" }[s.rating] : "";
    return `<li><span><b>${what}</b><br><span class="muted">${d} · ${moodLabel(s.mood)} · ${s.outcome}</span></span><span class="muted">${Math.round((s.listenedSec || 0) / 60)}m · ${s.skips} skips ${r}</span></li>`;
  }).join("");
  $("#share-preview").hidden = true;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ---------- share image ---------- */
$("#btn-share").addEventListener("click", async () => {
  const st = computeStats(), { A, B, all } = st;
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1350;
  const x = c.getContext("2d");
  const serif = '"Iowan Old Style", Palatino, Georgia, serif', mono = "Menlo, Consolas, monospace";
  x.fillStyle = "#141210"; x.fillRect(0, 0, 1080, 1350);
  x.fillStyle = "#e8643c"; x.beginPath(); x.arc(940, 150, 40, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#9a9083"; x.font = `28px ${mono}`;
  x.fillText((period ? `${period} DAYS` : "ALL TIME") + " · ONE ALBUM VS SHUFFLE", 80, 140);
  // headline: recall if both sides have it, otherwise albums played through
  const hasRecall = A.recall != null && B.recall != null;
  const lines = hasRecall
    ? ["I remembered", pct(A.recall), "of the albums I played,", `and ${pct(B.recall)} of shuffle sessions.`]
    : ["I played", String(st.finishedAlbums), `album${st.finishedAlbums === 1 ? "" : "s"} all the way through`, `and skipped ${Math.round((B.skips || 0) * B.n)} songs on shuffle.`];
  x.fillStyle = "#f1e9dc"; x.font = `500 84px ${serif}`;
  x.fillText(lines[0], 80, 270);
  x.fillStyle = "#e8643c"; x.font = `500 160px ${serif}`;
  x.fillText(lines[1], 80, 440);
  x.fillStyle = "#f1e9dc"; x.font = `500 52px ${serif}`;
  x.fillText(lines[2], 80, 520);
  x.fillText(lines[3], 80, 590);
  const rows = [["Hours listened", hrs(A.hours), hrs(B.hours)], ["Skips per session", num(A.skips), num(B.skips)], ["Played through", pct(A.finished), pct(B.finished)], ["It worked", pct(A.worked), pct(B.worked)]];
  let y = 740;
  x.font = `24px ${mono}`; x.fillStyle = "#9a9083";
  x.fillText("ONE ALBUM", 600, y - 50); x.fillText("SHUFFLE", 840, y - 50);
  for (const [l, a, b] of rows) {
    x.strokeStyle = "#2e2a25"; x.lineWidth = 2; x.beginPath(); x.moveTo(80, y - 40); x.lineTo(1000, y - 40); x.stroke();
    x.fillStyle = "#f1e9dc"; x.font = `36px -apple-system, Segoe UI, sans-serif`; x.fillText(l, 80, y + 10);
    x.font = `40px ${mono}`; x.fillText(String(a), 600, y + 10); x.fillText(String(b), 840, y + 10);
    y += 100;
  }
  x.fillStyle = "#9a9083"; x.font = `28px ${mono}`;
  x.fillText(`${all.n} sessions · ${hrs(all.hours)} total · ${hrs(st.perDay)} a day`, 80, 1250);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const url = URL.createObjectURL(blob);
  const img = $("#share-preview"); img.src = url; img.hidden = false;
  const file = new File([blob], "one-album-results.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch {}
  } else {
    const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
  }
});

/* ---------- settings ---------- */
function renderSettings() {
  $$('input[name="assign"]').forEach((r) => (r.checked = r.value === settings.assignment));
  $("#set-shuffle-len").value = settings.shuffleLength;
  $("#crate-summary").textContent = settings.crate.length ? `${settings.crate.length} albums in your crate` : "Using your whole library";
  const ago = library.fetchedAt ? Math.round((Date.now() - library.fetchedAt) / 864e5) : null;
  $("#lib-summary").textContent = `${library.albums.length} albums` + (ago != null ? ` · read ${ago === 0 ? "today" : ago + " days ago"}` : "");
  $("#set-token").value = settings.token || "";
}
$$('input[name="assign"]').forEach((r) => r.addEventListener("change", () => { settings.assignment = r.value; saveSettings(); }));
$("#set-shuffle-len").addEventListener("change", (e) => { settings.shuffleLength = Math.max(5, Math.min(40, Number(e.target.value) || 15)); saveSettings(); });
$("#btn-crate-clear").addEventListener("click", () => { settings.crate = []; saveSettings(); renderSettings(); });
$("#btn-refresh").addEventListener("click", async () => { if (settings.demo) return; await refreshLibrary(); });
$("#btn-save-token").addEventListener("click", () => { settings.token = $("#set-token").value.trim(); settings.demo = false; saveSettings(); location.reload(); });
$("#btn-signout").addEventListener("click", async () => {
  if (player) await player.signOut();
  settings.demo = false; saveSettings();
  library = { fetchedAt: 0, albums: [] }; saveLibrary();
  location.reload();
});
$("#btn-export").addEventListener("click", () => {
  const data = { app: "one-album", version: VERSION, exportedAt: new Date().toISOString(), settings: Object.assign({}, settings, { token: undefined }), sessions };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `one-album-${new Date().toISOString().slice(0, 10)}.json`; a.click();
});
$("#file-import").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const ids = new Set(sessions.map((s) => s.id));
    const added = (data.sessions || []).filter((s) => !ids.has(s.id));
    sessions = sessions.concat(added).sort((a, b) => a.startedAt - b.startedAt); saveSessions();
    alert(`Imported ${added.length} sessions.`);
  } catch { alert("That file didn't look like a One Album export."); }
});
$("#btn-reset").addEventListener("click", () => {
  if (!confirm("Delete every session on this device? Export first if you want a copy.")) return;
  sessions = []; saveSessions(); renderSettings();
});

/* ---------- crate ---------- */
function renderCrate() {
  const q = $("#crate-search").value.trim().toLowerCase();
  const set = new Set(settings.crate);
  const list = library.albums.filter((a) => !q || (a.name + " " + a.artist).toLowerCase().includes(q))
    .sort((a, b) => (set.has(b.id) - set.has(a.id)) || a.artist.localeCompare(b.artist)).slice(0, 300);
  $("#crate-list").innerHTML = list.map((a) => `<li><label>${a.art ? `<img src="${esc(a.art)}" alt="" loading="lazy">` : `<span class="ph"></span>`}
    <span><div class="t">${esc(a.name)}</div><div class="a">${esc(a.artist)}</div></span>
    <input type="checkbox" data-id="${esc(a.id)}" ${set.has(a.id) ? "checked" : ""}></label></li>`).join("");
  $("#crate-count").textContent = `${settings.crate.length} chosen`;
}
$("#crate-search").addEventListener("input", renderCrate);
$("#crate-list").addEventListener("change", (e) => {
  const id = e.target.dataset.id; if (!id) return;
  settings.crate = e.target.checked ? settings.crate.concat(id) : settings.crate.filter((x) => x !== id);
  saveSettings(); $("#crate-count").textContent = `${settings.crate.length} chosen`;
});

/* ---------- utils ---------- */
function fmtClock(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

boot();
})();
