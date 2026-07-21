export {};

/**
 * 3Speak Audio — the "SnapieAudioPlayer" at audio.3speak.tv, the audio arm of
 * the Hive-native 3Speak/Snapie ecosystem. Separate from the 3Speak VIDEO
 * connector (3speak.tv): this is a WaveSurfer (Web Audio) player with NO
 * <audio>/<video> element on the page, so playback state is read from the DOM
 * and the track metadata from 3Speak's audio API.
 *
 * Play-page / iframe-embed URL: audio.3speak.tv/play?a=<permlink> (or ?cid=).
 * Registered allFrames in core/connectors.ts so it also runs when the player
 * is embedded in a Hive post on peakd/ecency/3speak/etc.
 *
 * Metadata comes from GET audio.3speak.tv/api/audio?a=<permlink> (unauthenticated,
 * returns title/owner/duration/category) — the same robust "fetch from the API,
 * don't scrape the SPA" approach the video connector uses against Hive RPC.
 *
 * getOriginUrl returns the audio.3speak.tv URL so scrobble.life classifies these
 * as the '3SA' source (distinct from '3S' 3Speak video). kind = 'song' for music
 * categories, 'podcast' for spoken ones (voice_message / podcast / interview /
 * audiobook / noise_sample).
 */

const API_BASE = 'https://audio.3speak.tv/api/audio';

/** Spoken-word categories → podcast kind; everything else (song) → music. */
const SPOKEN_CATEGORIES = new Set([
	'voice_message',
	'podcast',
	'interview',
	'audiobook',
	'noise_sample',
]);

type AudioMeta = {
	title: string;
	owner: string;
	duration: number; // seconds
	category: string;
};

let audioMeta: AudioMeta | null = null;
let lastFetchedKey: string | null = null;

/** Read the audio ref from the play URL: ?a=<permlink> preferred, else ?cid=. */
function getAudioRef(): { param: 'a' | 'cid'; value: string } | null {
	if (window.location.pathname !== '/play') {
		return null;
	}
	const params = new URLSearchParams(window.location.search);
	const a = params.get('a');
	if (a) {
		return { param: 'a', value: a };
	}
	const cid = params.get('cid');
	if (cid) {
		return { param: 'cid', value: cid };
	}
	return null;
}

/** Fetch the audio item's metadata from the 3Speak audio API. */
async function fetchAudioMeta(ref: {
	param: 'a' | 'cid';
	value: string;
}): Promise<AudioMeta | null> {
	try {
		const res = await fetch(
			`${API_BASE}?${ref.param}=${encodeURIComponent(ref.value)}`,
		);
		if (!res.ok) {
			return null;
		}
		const d = await res.json();
		if (!d || d.error || !d.title) {
			return null;
		}
		return {
			title: String(d.title).trim(),
			owner: String(d.owner ?? '')
				.trim()
				.replace(/^@/, ''),
			duration: Number(d.duration) || 0,
			category: String(d.category ?? '').toLowerCase(),
		};
	} catch {
		return null;
	}
}

/** Refresh metadata when the ref changes; notify the core once it lands. */
async function refreshMetadataIfNeeded() {
	const ref = getAudioRef();
	if (!ref) {
		audioMeta = null;
		lastFetchedKey = null;
		return;
	}
	const key = `${ref.param}:${ref.value}`;
	if (lastFetchedKey === key && audioMeta) {
		return;
	}
	lastFetchedKey = key;
	audioMeta = null; // clear stale until the new fetch returns
	const fresh = await fetchAudioMeta(ref);
	if (lastFetchedKey === key) {
		audioMeta = fresh;
		Connector.onStateChanged();
	}
}

void refreshMetadataIfNeeded();

// The player is an SPA; re-fetch when the URL's ref changes.
let lastUrl = window.location.href;
new MutationObserver(() => {
	if (window.location.href !== lastUrl) {
		lastUrl = window.location.href;
		Connector.resetState();
		void refreshMetadataIfNeeded();
	}
}).observe(document.body, { childList: true, subtree: true });

Connector.playerSelector = 'body';

Connector.getTrack = () => audioMeta?.title ?? getAudioRef()?.value ?? null;

Connector.getArtist = () => audioMeta?.owner || null;

// Duration from the API (there's no media element to read it off).
Connector.getDuration = () =>
	audioMeta && audioMeta.duration > 0 ? audioMeta.duration : null;

// No <audio> element — infer play state from the control button's icon.
// The Material "play" triangle (d starts "M8 5v14…") means PAUSED; any other
// icon (the pause bars) means playing.
const PLAY_TRIANGLE_D = 'M8 5v14';
Connector.isPlaying = () => {
	const btn = document.querySelector(
		'button[aria-label="Play/Pause"], button.control-btn',
	);
	const d = btn?.querySelector('path')?.getAttribute('d') ?? '';
	return !!d && !d.startsWith(PLAY_TRIANGLE_D);
};

// Best-effort current time from the "M:SS / M:SS" readout. Null is fine —
// web-scrobbler then times the play from isPlaying transitions + duration.
Connector.getCurrentTime = () => {
	const el = Array.from(document.querySelectorAll('span, div, p, time')).find(
		(e) => /^\d+:\d\d\s*\/\s*\d+:\d\d$/.test((e.textContent ?? '').trim()),
	);
	const m = el?.textContent?.match(/(\d+):(\d\d)\s*\//);
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Spoken categories scrobble as podcasts; music categories as songs (default).
Connector.isPodcast = () =>
	audioMeta ? SPOKEN_CATEGORIES.has(audioMeta.category) : false;

Connector.getUniqueID = () => {
	const ref = getAudioRef();
	return ref ? `3speak-audio:${ref.value}` : null;
};

// The audio.3speak.tv URL — scrobble.life reads this as the '3SA' source.
Connector.getOriginUrl = () => window.location.href;

// No media-element events to hook, so poll: the WaveSurfer button icon + time
// readout update as it plays, and this keeps the controller's state in sync.
setInterval(() => Connector.onStateChanged(), 1000);
