export {};

/**
 * 3Speak (https://3speak.tv) — Hive-native video platform. Videos
 * posted on 3Speak are simultaneously Hive posts (each video has an
 * `author/permlink` on chain) so they fit naturally into scrobble.life's
 * "scrobble what you watch" model. Scrobbles ingest as kind='video'.
 *
 * Runs on TWO surfaces:
 *   1. Main watch page — https://3speak.tv/watch?v=<author>/<permlink>
 *      Full DOM with title, channel link, etc.
 *   2. Embed iframes — https://3speak.tv/embed?v=<author>/<permlink>
 *      Stripped-down player embedded into peakd / ecency / hive.blog
 *      / 3rd-party sites. Same JS bundle runs in the iframe; cascading
 *      fallbacks handle the leaner DOM (og: meta tags first, then URL
 *      params).
 *
 * v0.1 selectors — verified against 3speak.tv's current DOM as of
 * 2026-05. The site is a Next.js + Vue.js hybrid that hydrates after
 * initial paint, so selectors run against the rendered DOM. If 3Speak
 * reshapes their player markup, expect to retune `videoTitleSelector`,
 * `channelSelector`, and the time selectors first.
 */

// Video player — 3speak uses an HTML5 <video> element backed by an
// HLS source. Plain `video` selector works for the lone player on
// watch pages.
const videoSelector = 'video';

// Title — sits in an h1 near the video player. Fall back to a wider
// search just in case the markup shifts.
const videoTitleSelector = [
	'.video-info-content h1',
	'.video-content h1',
	'h1.video-title',
	'main h1',
];

// Channel / uploader — appears as a link to the Hive user's profile,
// e.g. <a href="/user/acidyo">acidyo</a>. We use this as the "artist"
// field for non-music videos.
const channelSelector = [
	'.video-info-content a[href^="/user/"]',
	'.video-author a',
	'a[href^="/user/"]',
];

// Playback progress — standard HTML5 video properties work; no need
// to scrape DOM time displays.

Connector.playerSelector = '#video-player, .video-js, .vjs-tech, main';

/** Pull author/permlink out of the watch URL — works for both main
 *  watch pages and embed iframes since both carry `?v=author/permlink`. */
function getVideoRef(): { author: string; permlink: string } | null {
	const params = new URLSearchParams(window.location.search);
	const v = params.get('v');
	if (!v) return null;
	const [author, permlink] = v.split('/', 2);
	if (!author || !permlink) return null;
	return { author, permlink };
}

/** OG meta-tag readers — 3Speak embed pages don't render a visible h1
 *  but typically expose og:title and og:video:director (or similar)
 *  in <head>. Used as the second-tier fallback for embed contexts. */
function getOgMeta(name: string): string | null {
	const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
	return (el as HTMLMetaElement | null)?.content?.trim() || null;
}

Connector.getTrack = () => {
	// Watch page: DOM h1.
	const dom = Util.getTextFromSelectors(videoTitleSelector);
	if (dom) {
		return dom.replace(/\s*[·•|]\s*3speak.*$/i, '').trim();
	}
	// Embed iframe: og:title in <head>.
	const og = getOgMeta('og:title');
	if (og) {
		return og.replace(/\s*[·•|]\s*3speak.*$/i, '').trim();
	}
	// Last resort: use the permlink slug. Not pretty (hyphenated) but
	// uniquely identifies the video so it can be scrobbled.
	const ref = getVideoRef();
	return ref?.permlink ?? null;
};

Connector.getArtist = () => {
	// Watch page: profile link.
	const dom = Util.getTextFromSelectors(channelSelector);
	if (dom) return dom.replace(/^@/, '').trim();
	// Embed iframe: og:video:director or similar; fall back to URL author.
	const og = getOgMeta('og:video:director') ?? getOgMeta('article:author');
	if (og) return og.replace(/^@/, '').trim();
	// Last resort: URL author param.
	return getVideoRef()?.author ?? null;
};

Connector.getCurrentTime = () => {
	const v = document.querySelector(videoSelector) as HTMLVideoElement | null;
	return v && isFinite(v.currentTime) ? v.currentTime : null;
};

Connector.getDuration = () => {
	const v = document.querySelector(videoSelector) as HTMLVideoElement | null;
	return v && isFinite(v.duration) ? v.duration : null;
};

Connector.isPlaying = () => {
	const v = document.querySelector(videoSelector) as HTMLVideoElement | null;
	if (!v) return false;
	return !v.paused && !v.ended;
};

Connector.getUniqueID = () => {
	// 3speak watch URLs carry the video identifier as ?v=author/permlink.
	// Use the full author/permlink string as the unique id — it's stable
	// across reloads and uniquely identifies the on-chain post.
	const params = new URLSearchParams(window.location.search);
	const v = params.get('v');
	return v ? `3speak:${v}` : null;
};

// Most 3Speak content is vlog / talk / gaming / lifestyle — not music.
// Default to kind='video' so the streamer routes scrobbles into the
// /videos tab. If a particular channel turns out to be primarily music,
// we can add a music-signal pass later (similar to how YouTube has
// looksLikeMusicSignal).
Connector.isVideo = () => true;

// Watch state — fire the model update on whatever signals the player
// exposes. video element events handle most cases.
Connector.onScriptEvent = async (e) => {
	if (e.type === 'TRACK_PLAYING_STATE') {
		Connector.onStateChanged();
	}
};

// Trigger state updates on common video player events.
const v = document.querySelector(videoSelector);
if (v) {
	v.addEventListener('play',     () => Connector.onStateChanged());
	v.addEventListener('pause',    () => Connector.onStateChanged());
	v.addEventListener('ended',    () => Connector.onStateChanged());
	v.addEventListener('timeupdate', () => Connector.onStateChanged());
}

// Page navigation in the Next.js app doesn't trigger reload, so watch
// URL changes too — when ?v=author/permlink changes, the connector
// needs to re-read.
let lastUrl = window.location.href;
new MutationObserver(() => {
	if (window.location.href !== lastUrl) {
		lastUrl = window.location.href;
		Connector.resetState();
		Connector.onStateChanged();
	}
}).observe(document.body, { childList: true, subtree: true });
