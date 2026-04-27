# Hive Scrobbler — Install Guide

Hive Scrobbler is a browser extension that scrobbles what you listen to (and watch) onto the **Hive blockchain** — feeless, permanent, owned by you. Site: <https://scrobble.life>

This `.zip` is an **unpacked extension build**. You install it manually until the Chrome Web Store listing is approved. Takes 60 seconds.

---

## Chrome / Brave / Edge / Opera (Chromium-based browsers)

1. **Unzip** this archive somewhere you'll keep it (e.g. `Documents/hive-scrobbler/`). Don't delete the folder later — Chrome loads the extension straight from this directory.
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`, etc.).
3. Toggle **Developer mode** on (top-right corner).
4. Click **Load unpacked**.
5. Select the unzipped folder (the one that contains `manifest.json`).
6. The Hive Scrobbler icon appears in your toolbar — pin it for easy access.

You'll also need **[Hive Keychain](https://hive-keychain.com/)** installed in the same browser for signing scrobbles. Click the Hive Scrobbler icon → **Connect with Keychain** → pick your Hive account → done.

## Firefox

1. Unzip this archive somewhere you'll keep it.
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…**
4. Select the `manifest.json` file inside the unzipped folder.

Firefox treats this as temporary — it'll need re-loading every time you restart the browser until Mozilla Add-ons signs the build.

## Safari

Not supported yet. Safari requires a separate `.app` bundle and a paid Apple developer account. Coming later.

---

## What it tracks

- **Music** — Spotify, YouTube, YouTube Music, SoundCloud, Apple Music, Tidal, Deezer, Bandcamp, Amazon Music, Audius, Mixcloud, Audiomack, Pandora, iHeartRadio, SiriusXM
- **Movies & TV** — Netflix, Disney+, Max (HBO), Prime Video
- **Podcasts** — Overcast, Pocket Casts (plus Spotify shows)
- **Non-music YouTube videos** — vlogs, comedy, news, etc. land in your videos history (toggle in settings if you'd rather skip them)

A scrobble is recorded once you've played a track past the duration threshold (~60% of the runtime for music, 80% for video). Below that, nothing's broadcast.

The connectors page in the extension settings splits these into **Music** and **Movies, TV & Podcasts** sections so you can enable/disable by category.

## Privacy

- **No tracking, no analytics, no telemetry.** The extension never phones home.
- Your **Hive private keys** stay in Keychain — Hive Scrobbler never sees them.
- Each scrobble is a `custom_json` op signed by Keychain at broadcast time. The extension only knows what you're listening to right now.
- Future privacy tiers are on the roadmap (followers-only encrypted, fully private). For now, scrobbles are public on Hive.

## Where to see your scrobbles

<https://scrobble.life> — your music history shows up at `/u/<your-hive-username>`. Movies, TV and podcasts have their own pages from the top nav.

## Troubleshooting

- **Nothing's scrobbling** — make sure Keychain is installed and you're connected (toolbar icon → "Connect with Keychain"). Some sites need a page reload after the extension is first loaded.
- **The toolbar icon shows "—"** — the extension didn't recognise the page. Check the supported sites list above.
- **Scrobble didn't broadcast** — Keychain may have rejected the signature. Re-connect and try again.
- **Don't want non-music YouTube videos scrobbled** — Options page → YouTube section → uncheck "Scrobble non-music videos as videos."

## Source

<https://github.com/Holozing1/hivescrobble> — fork of [Web Scrobbler](https://github.com/web-scrobbler/web-scrobbler) (MIT). PRs welcome.
