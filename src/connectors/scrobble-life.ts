export {};

/**
 * scrobble.life — the in-site player's Audius tracks.
 *
 * Reads the bar's persistent `<audio id="zingit-audio">` element and the
 * data-attrs the page keeps on it (artist / track / id / origin = the Audius
 * stream URL). YouTube tracks in the bar play in a separate iframe handled by
 * the youtube-embed connector and leave the <audio> with no source, so this
 * connector stays idle for them (isPlaying gates on currentSrc).
 *
 * On load it drops a `data-hobbles-audius` marker (+ a `hobbles:audius` event)
 * so the website knows this connector exists and can hand Audius scrobbling
 * over to the extension instead of double-scrobbling via Keychain. See
 * zingit-web: components/HiveAuthProvider.tsx + components/player/PlayerProvider.tsx.
 */

const AUDIO_SELECTOR = '#zingit-audio';

function audioEl(): HTMLAudioElement | null {
	return document.querySelector(AUDIO_SELECTOR) as HTMLAudioElement | null;
}

// Tell the page our Audius connector is live so it stops Keychain-scrobbling
// Audius tracks (which we now handle). Marker for synchronous reads + event for
// the page-mounted-first race.
function announceAudius(): void {
	try {
		document.documentElement.setAttribute('data-hobbles-audius', '1');
		document.dispatchEvent(new CustomEvent('hobbles:audius'));
	} catch {
		// DOM not ready / sandboxed — non-fatal.
	}
}

function setupConnector(audio: HTMLAudioElement): void {
	for (const ev of [
		'timeupdate',
		'play',
		'pause',
		'ended',
		'loadedmetadata',
	]) {
		audio.addEventListener(ev, Connector.onStateChanged);
	}

	Connector.getArtistTrack = () => ({
		artist: audio.dataset.artist || null,
		track: audio.dataset.track || null,
	});

	Connector.getCurrentTime = () => audio.currentTime;

	Connector.getDuration = () => audio.duration;

	// Only a loaded Audius stream counts as playing. YouTube tracks clear the
	// <audio> src, so currentSrc is empty and we report not-playing.
	Connector.isPlaying = () =>
		!audio.paused && !audio.ended && Boolean(audio.currentSrc);

	// The Audius stream URL — the streamer pulls the encoded track id out of it
	// (see resolveAudiusId in stream-scrobbles.mjs).
	Connector.getOriginUrl = () => audio.dataset.originUrl || null;

	Connector.getUniqueID = () => audio.dataset.id || null;
}

function setupWithRetry(attempts = 0): void {
	const audio = audioEl();
	if (!audio) {
		if (attempts > 40) {
			return;
		}
		setTimeout(() => setupWithRetry(attempts + 1), 500);
		return;
	}
	setupConnector(audio);
}

announceAudius();
setupWithRetry();
