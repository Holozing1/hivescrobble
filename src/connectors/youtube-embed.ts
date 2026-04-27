export {};

/**
 * Generic connector for Youtube embed videos.
 */

const VIDEO_SELECTOR = '.html5-main-video';
const PLAYER_SELECTOR = '.html5-video-player';

// Track info injected by the Zingit page via postMessage. The page is the
// authoritative source for what's playing — it's the one that called
// loadVideoById on the YouTube player, so we trust its videoId/artist/track
// over whatever the iframe's player state currently reports.
//
// Earlier versions used a "pending" two-phase commit that waited for
// `player.getVideoData().video_id` to match before flushing, but that was
// unreliable: when the getVideoData lookup falls back to
// `window.location.href` (the iframe URL is frozen at the first video), it
// reports the initial videoId forever, so the second song never committed
// and the extension got stuck on whatever was first loaded.
let injected: {
	videoId: string | null;
	artist: string | null;
	track: string | null;
} | null = null;

window.addEventListener('message', (event: MessageEvent) => {
	if (event.data?.__hobbles && event.data.type === 'zingitTrack') {
		injected = {
			videoId: event.data.videoId || null,
			artist: event.data.artist || null,
			track: event.data.title || null,
		};
	}
});

/**
 * YouTube attaches getVideoData() to the player container element.
 * Returns { video_id, title, author } for whatever is currently loaded.
 */
function getPlayerData(): {
	video_id?: string;
	title?: string;
	author?: string;
} | null {
	const player = document.querySelector(PLAYER_SELECTOR) as Record<
		string,
		unknown
	> | null;
	if (typeof player?.getVideoData === 'function') {
		return player.getVideoData() as {
			video_id?: string;
			title?: string;
			author?: string;
		};
	}
	return null;
}

function getVideoId(): string | null {
	// Parent-injected videoId wins — see comment on `injected` above. We only
	// fall back to the player/URL lookup when no host page has claimed this
	// embed (e.g. a vanilla site that just embeds a YouTube iframe).
	if (injected?.videoId) return injected.videoId;
	return getPlayerData()?.video_id ?? Util.getYtVideoIdFromUrl(window.location.href);
}

function getArtistTrack(): { artist: string | null; track: string | null } {
	// Prefer info sent by the Zingit page — it knows exactly what's playing.
	if (injected) return { artist: injected.artist, track: injected.track };

	// Fall back to player API (only works when called from page context, not here)
	const data = getPlayerData();
	if (data?.title) {
		const parsed = Util.processYtVideoTitle(data.title);
		if (parsed.artist) return { artist: parsed.artist ?? null, track: parsed.track ?? null };
		const author = (data.author ?? '').replace(/ - Topic$/i, '').trim();
		return { artist: author || null, track: parsed.track ?? data.title };
	}

	// Last resort: document.title
	const docTitle = document.title.replace(/\s*[-–]\s*YouTube\s*$/i, '').trim();
	const fallback = Util.processYtVideoTitle(docTitle);
	return { artist: fallback.artist ?? null, track: fallback.track ?? null };
}

function setupConnector() {
	const videoElement = document.querySelector(
		VIDEO_SELECTOR,
	) as HTMLVideoElement;
	if (!videoElement) return;

	videoElement.addEventListener('timeupdate', Connector.onStateChanged);

	Connector.getArtistTrack = getArtistTrack;

	Connector.getCurrentTime = () => videoElement.currentTime;

	Connector.getDuration = () => videoElement.duration;

	Connector.isPlaying = () => !videoElement.paused && !videoElement.ended;

	Connector.getOriginUrl = () => `https://youtu.be/${getVideoId()}`;

	Connector.getUniqueID = () => getVideoId();

	Connector.applyFilter(MetadataFilter.createYouTubeFilter());
}

function setupWithRetry(attempts = 0): void {
	if (attempts > 40) return;
	const videoElement = document.querySelector(
		VIDEO_SELECTOR,
	) as HTMLVideoElement | null;
	if (!videoElement) {
		setTimeout(() => setupWithRetry(attempts + 1), 500);
		return;
	}
	setupConnector();
}

setupWithRetry();
