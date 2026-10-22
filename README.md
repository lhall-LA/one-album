# One Album

One question — *what's your mood?* — then one album from your own Apple Music library, played through. No search, no browsing, no skip button.

It's also an experiment. Sessions are randomly assigned to **one album** or **shuffle**, and the app tracks how each goes so you can compare them side by side after 7 or 30 days.

- Runs entirely on your phone. No server, no account, no tracking. Data lives in the browser and you can export it as JSON.
- Free to host on GitHub Pages.
- Works as a home-screen app (PWA) on iPhone and Android.

## What it measures

| | |
|---|---|
| Hours listened | total and per day |
| Skips | any track left before 90% (including skips from the lock screen) |
| Played through | sessions that reached the end vs ended early |
| It worked | your one-tap rating after each session: yes / sort of / no |
| Next-day recall | 8+ hours later the app asks what you listened to, before showing you |
| By mood | which moods got the best-rated sessions |

**Results** shows the two modes side by side and makes a share image.

## Experiments

In **Settings**:

- **Assignment** — random (balanced, for the side-by-side test), one album only, or shuffle only.
- **Crate** — limit the pool to a handful of albums you choose, to test whether a small collection is enough.
- **Shuffle length** — how many songs a shuffle session gets (default 15, roughly an album).

Change one thing per run so the comparison stays clean.

## Try it without Apple Music

Open the app and tap **Try the demo**. It uses a fake library, plays no sound and runs time 30× faster, so you can click through a whole session in a minute. Demo sessions are kept separate from real ones.

## Set it up for real

You need an Apple Developer account and Apple Music on your phone. Everything below works from Windows.

### 1. Make a MusicKit key

1. Go to [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles**.
2. Under **Identifiers**, create a **Media ID** if you don't have one (Apple asks for this before a MusicKit key).
3. Under **Keys**, click **+**, tick **Media Services (MusicKit, ShazamKit, Apple Music Feed)**, pick your Media ID, and continue.
4. Download the `.p8` file — **you can only download it once**. Note the **Key ID**.
5. Note your **Team ID** (top right of the account page).

Keep the `.p8` file out of this repo. `.gitignore` already blocks `*.p8`.

### 2. Make a developer token

Install [Node.js](https://nodejs.org) (18 or newer), then from this folder:

```
node tools/make-token.mjs --team YOUR_TEAM_ID --key YOUR_KEY_ID --p8 C:\path\to\AuthKey_XXXX.p8 --origin https://YOUR_GITHUB_NAME.github.io
```

It prints a long token. Paste it into `config.js` as `developerToken`.

Tokens last up to 180 days — set a reminder to make a new one. The `--origin` flag locks the token to your site, which is why it's fine for it to sit in public code.

### 3. Put it online

1. Create a public GitHub repo and upload these files (or `git push` them).
2. Repo → **Settings** → **Pages** → deploy from the `main` branch, root folder.
3. Your app is at `https://YOUR_GITHUB_NAME.github.io/REPO_NAME/`.

### 4. Put it on your phone

Open that link in **Safari** on your iPhone → **Share** → **Add to Home Screen**. Open it from the home screen, tap **Connect Apple Music**, and allow access.

## Test this first

**Does music keep playing when the phone locks or you switch apps?** Web apps on iOS are less reliable than native apps here. Run one album with the screen locked before committing to a 7-day run. If playback cuts out, that's a known limit of the web route and the next step would be a native build.

Also:

- iOS can clear storage for web apps that go unused for a few weeks. Export your data now and then (Settings → Export JSON).
- If you change files, bump `CACHE` in `sw.js` so phones pick up the new version.

## How the album is picked

Simple and transparent, no AI:

- Each mood has a list of genres (e.g. Calm → jazz, ambient, classical, folk…). Albums matching your mood are much more likely to be picked; anything else can still come up as a wildcard.
- Free text is matched to a mood by keywords ("gym" → Amped, "rainy" → Sad, "work" → Focused).
- **Nostalgic** favours the oldest third of your library.
- Albums from your last 15 sessions are mostly avoided. Singles and EPs under 4 tracks are skipped.

The play screen shows why an album was picked. Tweak `MOODS` and `WORDS` at the top of `app.js` to change it.

## Files

```
index.html            screens
app.css               styles
app.js                everything else
config.js             your app name and developer token
sw.js                 offline cache
manifest.webmanifest  home-screen app details
tools/make-token.mjs  makes the MusicKit developer token
icons/                app icons
```

## Licence

MIT — see `LICENSE`.
