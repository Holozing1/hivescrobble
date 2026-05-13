export {};

/**
 * 3Speak (https://3speak.tv) — Hive-native video platform.
 *
 * Every 3Speak video IS a Hive post — the URL carries `?v=author/permlink`
 * and the metadata (title, body, tags) lives on chain. 3Speak's web app
 * is a client-rendered SPA with no server-side OG tags and obfuscated
 * CSS class names, so DOM scraping is fragile. We sidestep all that by
 * fetching the post metadata directly from a Hive RPC node using the
 * author/permlink in the URL.
 *
 * Coverage:
 *   1. Main watch page — https://3speak.tv/watch?v=author/permlink
 *   2. Embed iframes  — https://3speak.tv/embed?v=author/permlink
 *      (registered separately in core/connectors.ts with allFrames:true)
 *
 * The <video> element is always plain HTML5 backed by an HLS stream,
 * so playback state (current time, duration, play/pause) reads
 * directly off it — no player-library-specific selectors needed.
 */

const HIVE_NODES = [
	'https://api.deathwing.me',
	'https://api.hive.blog',
	'https://api.openhive.network',
];

/** Cached metadata for the currently-displayed video, keyed by ref. */
type VideoMeta = { title: string; author: string };
let videoMeta: VideoMeta | null = null;
let lastFetchedRef: string | null = null;

/** Parse `?v=author/permlink` from the current URL. Works for both
 *  /watch?v=... and /embed?v=... since both paths carry the same param. */
function getVideoRef(): { author: string; permlink: string; raw: string } | null {
	const params = new URLSearchParams(window.location.search);
	const v = params.get('v');
	if (!v) return null;
	const [author, permlink] = v.split('/', 2);
	if (!author || !permlink) return null;
	return { author, permlink, raw: v };
}

/** Fetch the Hive post for the given author/permlink. Tries each RPC
 *  node in turn, returns null on total failure. */
async function fetchHivePost(author: string, permlink: string): Promise<VideoMeta | null> {
	for (const node of HIVE_NODES) {
		try {
			const res = await fetch(node, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					method:  'condenser_api.get_content',
					params:  [author, permlink],
					id:      1,
				}),
			});
			if (!res.ok) continue;
			const data = await res.json();
			const post = data?.result;
			if (!post || !post.author) continue;
			return {
				title:  String(post.title ?? '').trim(),
				author: post.author,
			};
		} catch {
			// network blip — try the next node
		}
	}
	return null;
}

/** Trigger an async metadata refresh when the URL's ?v= ref changes.
 *  Stores the result in `videoMeta` and notifies the connector core
 *  so the getters re-read on the next state cycle. */
async function refreshMetadataIfNeeded() {
	const ref = getVideoRef();
	if (!ref) {
		videoMeta = null;
		lastFetchedRef = null;
		return;
	}
	if (lastFetchedRef === ref.raw && videoMeta) return;
	lastFetchedRef = ref.raw;
	videoMeta = null;          // clear stale until new fetch returns
	const fresh = await fetchHivePost(ref.author, ref.permlink);
	// Only adopt the result if the URL hasn't moved on while we were waiting.
	if (lastFetchedRef === ref.raw) {
		videoMeta = fresh;
		Connector.onStateChanged();
	}
}

// Fire an initial fetch immediately and again on URL changes.
void refreshMetadataIfNeeded();

let lastUrl = window.location.href;
new MutationObserver(() => {
	if (window.location.href !== lastUrl) {
		lastUrl = window.location.href;
		Connector.resetState();
		void refreshMetadataIfNeeded();
	}
}).observe(document.body, { childList: true, subtree: true });

// HTML5 <video> element on the page — used for play/pause/time tracking.
const videoSelector = 'video';

Connector.playerSelector = '#video-player, .video-js, .vjs-tech, main';

Connector.getTrack = () => {
	// Pull from cached Hive metadata when available. URL fallback uses
	// the permlink slug, which is hyphenated and ugly but better than
	// no title at all (e.g. while the chain fetch is in flight).
	if (videoMeta?.title) return videoMeta.title;
	return getVideoRef()?.permlink ?? null;
};

Connector.getArtist = () => {
	// Author from the Hive post is the same as the URL's author param,
	// so either source works. Strip a leading @ defensively (Hive
	// usernames don't carry it on chain but some UIs prepend one).
	const a = videoMeta?.author ?? getVideoRef()?.author ?? null;
	return a ? a.replace(/^@/, '') : null;
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
	const ref = getVideoRef();
	return ref ? `3speak:${ref.raw}` : null;
};

// 3Speak hosts mostly user-generated video content (vlogs, talks,
// gaming, music videos, etc.) — default to kind='video' so the
// streamer routes scrobbles into the /videos tab. Music-detection
// heuristics can be layered on later if a meaningful music audience
// emerges on 3Speak.
Connector.isVideo = () => true;

// Trigger state updates on standard <video> events. Hook this up on
// every state cycle because the video element may not exist at
// connector-load time (SPA hydration is async).
let videoElementHooked: HTMLVideoElement | null = null;
function ensureVideoHooks() {
	const v = document.querySelector(videoSelector) as HTMLVideoElement | null;
	if (!v || v === videoElementHooked) return;
	videoElementHooked = v;
	v.addEventListener('play',       () => Connector.onStateChanged());
	v.addEventListener('pause',      () => Connector.onStateChanged());
	v.addEventListener('ended',      () => Connector.onStateChanged());
	v.addEventListener('timeupdate', () => Connector.onStateChanged());
}
// Re-check periodically until the SPA renders the player.
setInterval(ensureVideoHooks, 1000);
ensureVideoHooks();
