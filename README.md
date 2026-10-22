# One Album

Pull one record off your own shelf and play it through. Skip works. When it ends, nothing else starts until you choose.

It's also a small personal experiment. Each session is randomly given one of three modes, and the app tracks how each goes:

| Mode | What happens |
|---|---|
| **Shuffle** | Random songs from your whole Apple Music library, about 45 minutes. |
| **Random album** | One album picked at random from your library, played in order. |
| **Your crate** | You pick one of 8–10 albums you chose at the start of the run, played in order. |

- Runs entirely on your phone. No server, no account, no tracking. Data lives in the browser, and you can export it as JSON.
- Free to host on GitHub Pages.
- Works as a home-screen app (PWA) on iPhone and Android.

## How a run works

1. **Choose your crate.** On first launch you pick 8–10 albums from your library. They stay fixed for the run. Changing them starts a new run.
2. **How are you feeling?** Optional, one tap. It's logged for context and doesn't change what plays.
3. **The mode is revealed.** Modes come in shuffled blocks of three, so each mode comes up once per block, in random order. There are no re-rolls: backing out keeps the same mode waiting for next time.
4. **Tap Play.** Skip works in every mode. Hold the button to end early.
5. **Was that a good listen?** Yes / Sort of / No.
6. **Memory check.** 8 hours to 4 days later, the app asks what you listened to, then shows you.

## What it measures

| | |
|---|---|
| Good listen | the main measure: Yes / Sort of / No after each session, scored 1 / ½ / 0 |
| Skip runs | 3 or more skips in a row, the skip-skip-skip pattern |
| Skips | a skip press, or a track left before 90% (including lock-screen skips) |
| Played through / ended early | how sessions finished |
| Minutes per session | time actually playing |
| Next-day recall | did you name at least one correct artist or title? Same rule for every mode |

**Results** shows the three modes side by side, with how many sessions each number is based on, and makes a share image. Sessions from a forced mode (Settings), the demo, or another person's imported export never count.

## Try it without Apple Music

Open the app and tap **Try the demo**. It uses a fake library, plays no sound and runs time 30× faster (add `?speed=120` to the URL to go faster). Demo sessions and the demo run are kept separate from real ones.

## Set it up for real

You need an Apple Developer account and Apple Music on your phone. Everything below works from Windows.

### 1. Make a MusicKit key

1. Go to [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles**.
2. Under **Identifiers**, create a **Media ID** if you don't have one (Apple asks for this before a MusicKit key).
3. Under **Keys**, click **+**, tick **Media Services (MusicKit, ShazamKit, Apple Music Feed)**, pick your Media ID, and continue.
4. Download the `.p8` file. **You can only download it once.** Note the **Key ID**.
5. Note your **Team ID** (top right of the account page).

Keep the `.p8` file out of this repo. `.gitignore` already blocks `*.p8`.

### 2. Make a developer token

Install [Node.js](https://nodejs.org) (18 or newer), then from this folder:

```
node tools/make-token.mjs --team YOUR_TEAM_ID --key YOUR_KEY_ID --p8 C:\path\to\AuthKey_XXXX.p8 --origin https://YOUR_GITHUB_NAME.github.io
```

It prints a long token. Paste it into `config.js` as `developerToken`.

Tokens last up to 180 days, so set a reminder to make a new one. The `--origin` flag locks the token to your site, which is why it's fine for it to sit in public code.

### 3. Put it online

1. Push this repo to GitHub (public).
2. Repo → **Settings** → **Pages** → deploy from the `main` branch, root folder.
3. Your app is at `https://YOUR_GITHUB_NAME.github.io/REPO_NAME/`.

**Don't change that address during a run.** The phone stores your data per web address, so a new address starts empty.

### 4. Put it on your phone

Open that link in **Safari** on your iPhone → **Share** → **Add to Home Screen**. Open it from the home screen, tap **Connect Apple Music**, and allow access. Safari and the home-screen app keep separate data, so always use the home-screen app.

## Test this first

On a real iPhone, before day 1:

1. Play starts audio in all three modes, including shuffle.
2. Lock the phone and listen through at least one track change. The next track must start.
3. An album plays in order. Skip moves within it, and lock-screen or AirPods skips get logged.
4. The end of an album lands on the rating screen once, and nothing else starts.
5. Export works through the share sheet.

If 1 or 2 fails, that's a limit of the web route, and the next step would be a native build.

Also:

- iOS can clear storage for web apps that go unused for a few weeks. Export your data now and then (Settings → Export JSON).
- If you change files, bump `CACHE` in `sw.js` so phones pick up the new version.

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

MIT. See `LICENSE`.
