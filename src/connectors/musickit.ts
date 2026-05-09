export {};

/*
 * Connector for Apple's MusicKit JS.
 */

let trackInfo = {};
let isPlaying = false;

Connector.isPlaying = () => isPlaying;

Connector.getTrackInfo = () => trackInfo;

// Override the default getOriginUrl (which returns document.location.href)
// so we send the song's canonical Apple Music permalink — the URL
// MusicKit reports for the now-playing item — instead of whatever page
// the user is browsing while the track plays. Falls back to the page
// URL if MusicKit didn't expose one (rare).
Connector.getOriginUrl = () => {
	const ti = trackInfo as { originUrl?: string | null };
	return ti.originUrl ?? document.location.href;
};

Connector.onScriptEvent = (e) => {
	switch (e.data.type) {
		case 'MUSICKIT_STATE':
			trackInfo = e.data.trackInfo as object;
			isPlaying = e.data.isPlaying as boolean;

			Connector.onStateChanged();
			break;
		default:
			break;
	}
};

Connector.injectScript('connectors/musickit-dom-inject.js');
