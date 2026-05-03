<div align="center">

<p>
	<img width="128" src="./src/icons/main/universal.svg"/>
</p>
<h1>Hive Scrobbler</h1>

[![Test status][GitHubActionsBadge]][GitHubActions]

</div>

Hive Scrobbler is a browser extension that scrobbles your music listening history to the **Hive blockchain** via [Hive Keychain][HiveKeychain]. It is a fork of [Web Scrobbler][WebScrobbler] (MIT).

Every song you listen to is recorded as a `custom_json` operation on Hive — feeless, permanent, and owned by you.

## Supported Platforms

**Music**: YouTube, YouTube Music, Spotify, SoundCloud, Apple Music, Tidal, Deezer, Amazon Music, Bandcamp, Audius, Mixcloud, Audiomack, Pandora, iHeartRadio, SiriusXM

**Movies & TV**: Netflix, Disney+, Max (HBO), Prime Video

**Podcasts**: Overcast, Pocket Casts, Spotify shows

## Requirements

- A Hive account
- [Hive Keychain][HiveKeychain] browser extension installed

## Setup

1. Install Hive Scrobbler (see below)
2. Open the extension settings and go to **Accounts**
3. Click **Connect with Keychain**, enter your Hive username, and approve the login popup
4. Done — your scrobbles will post to Hive automatically as you listen

## Installation

Hive Scrobbler is not yet on extension stores. Install it from source:

### Chrome / Edge / Brave

1. Clone or download this repo
2. Run `npm install` then `npm run dist chrome`
3. Open `chrome://extensions`, enable **Developer mode**
4. Click **Load unpacked** and select the `build/chrome` folder

### Firefox

1. Run `npm install` then `npm run dist:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** and select `build/firefox/manifest.json`

Firefox treats this as temporary — it'll be removed on browser restart until the build is signed by Mozilla Add-ons (AMO).

## How Scrobbling Works

- A scrobble fires after you've listened to **60%** of a song
- The actual broadcast to Hive happens when the song ends (not at the 60% mark), so `percent_played` reflects your real listening time
- If you replay the same song, additional transactions are sent — one per full listen cycle (160%, 260%, …)
- Each scrobble is a `hive_scrobble_ai` custom_json operation signed by your posting key via Keychain — no secrets are ever stored in the extension

## Development

```sh
# Install dependencies
npm install

# Dev build, Chrome (auto-rebuilds on changes)
npm run dev

# Dev build, Firefox
npm run dev:firefox

# Production build + zip
npm run dist chrome     # → build/chrome/    + hive-scrobbler-chrome.zip
npm run dist:firefox    # → build/firefox/   + hive-scrobbler-firefox.zip + hive-scrobbler-src.zip

# Lint the Firefox build (web-ext)
npm run lint:firefox
```

See [`SOURCE_BUILD.md`](./SOURCE_BUILD.md) for the build reproduction details required by AMO reviewers.

## License

Fork of [Web Scrobbler][WebScrobbler] — licensed under the [MIT License][License].

<!-- Badges -->

[GitHubActionsBadge]: https://img.shields.io/github/actions/workflow/status/Holozing/hivescrobble/test.yml

<!-- Links -->

[GitHubActions]: https://github.com/Holozing/hivescrobble/actions
[HiveKeychain]: https://hive-keychain.com
[WebScrobbler]: https://github.com/web-scrobbler/web-scrobbler
[License]: ./LICENSE.md
