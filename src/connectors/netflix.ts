/**
 * Netflix connector — long-form video scrobbler for the Hive integration.
 *
 * Reads playback state from the <video> element and the Netflix player UI's
 * title overlay. Episode info ("S1:E3 The Pilot") and movie/episode
 * disambiguation come from DOM scraping; canonical metadata (tmdbId, year,
 * poster) is filled in later by the TMDB pipeline stage.
 *
 * Netflix's React internal state (window.netflix.appContext) would give us
 * episode IDs directly, but it lives in the MAIN world we can't reach from
 * here, and the DOM-only path is sufficient since we resolve via TMDB anyway.
 */

export {};

const watchUrlRegex = /\/watch\/(?<id>\d+)/;

Connector.playerSelector = '.watch-video, [data-uia="player"]';

Connector.isVideo = () => true;

// Netflix exposes the player's title overlay in different DOM shapes across
// A/B-test variants. We try several selector combos for resilience.

function getMainVideoElement(): HTMLVideoElement | null {
	// Pick the largest <video> element on the page (Netflix may have hidden
	// preview videos in carousels; we want the active player).
	const videos = Array.from(document.querySelectorAll('video'));
	if (videos.length === 0) return null;
	return videos.reduce((biggest, candidate) =>
		candidate.duration > (biggest.duration || 0) ? candidate : biggest,
	);
}

function getPlayerTitleEl(): HTMLElement | null {
	return document.querySelector(
		'.video-title h4, [data-uia="video-title"] h4, [data-uia="video-title"]',
	) as HTMLElement | null;
}

function getEpisodeOverlayText(): string | null {
	// "S1:E3 Episode Title" or just "Episode Title" depending on variant.
	const el = document.querySelector(
		'.video-title span, [data-uia="video-title"] span',
	) as HTMLElement | null;
	const text = el?.textContent?.trim();
	return text && text.length > 0 ? text : null;
}

interface ParsedEpisode {
	season: number | null;
	episode: number | null;
	title: string;
}

function parseEpisodeOverlay(text: string): ParsedEpisode {
	// Common forms:
	//   "S1:E3 Pilot"
	//   "Season 1: Episode 3 'Pilot'"
	//   "Pilot" (just the episode title — fall back to TMDB lookup)
	const concise = /^S(\d+):E(\d+)\s*(.*)$/i.exec(text);
	if (concise) {
		return {
			season: parseInt(concise[1], 10),
			episode: parseInt(concise[2], 10),
			title: concise[3].trim(),
		};
	}
	const verbose = /Season\s+(\d+).*Episode\s+(\d+)\s*[:.]?\s*['"]?(.*?)['"]?$/i.exec(text);
	if (verbose) {
		return {
			season: parseInt(verbose[1], 10),
			episode: parseInt(verbose[2], 10),
			title: verbose[3].trim(),
		};
	}
	return { season: null, episode: null, title: text };
}

function isEpisodeContext(): boolean {
	// If the player overlay has any season/episode marker, we're on an episode.
	const text = getEpisodeOverlayText();
	if (!text) return false;
	return /^S\d+:E\d+|Season\s+\d+.*Episode\s+\d+/i.test(text);
}

Connector.getVideoKind = () => (isEpisodeContext() ? 'episode' : 'movie');

Connector.getTrack = () => {
	if (isEpisodeContext()) {
		const overlayText = getEpisodeOverlayText();
		if (overlayText) {
			const { title } = parseEpisodeOverlay(overlayText);
			if (title) return title;
		}
	}
	const titleEl = getPlayerTitleEl();
	return titleEl?.textContent?.trim() ?? null;
};

Connector.getArtist = () => {
	// For episodes, the "artist" slot carries the series title so the existing
	// popup music UI shows something sensible. For movies, leave null.
	if (!isEpisodeContext()) return null;
	const titleEl = getPlayerTitleEl();
	return titleEl?.textContent?.trim() ?? null;
};

Connector.getAlbum = () => {
	// Repurpose album as "Season N" for episodes — readable in the popup.
	if (!isEpisodeContext()) return null;
	const overlayText = getEpisodeOverlayText();
	if (!overlayText) return null;
	const { season } = parseEpisodeOverlay(overlayText);
	return season ? `Season ${season}` : null;
};

Connector.getSeriesTitle = () => {
	if (!isEpisodeContext()) return null;
	const titleEl = getPlayerTitleEl();
	return titleEl?.textContent?.trim() ?? null;
};

Connector.getSeason = () => {
	if (!isEpisodeContext()) return null;
	const overlayText = getEpisodeOverlayText();
	if (!overlayText) return null;
	return parseEpisodeOverlay(overlayText).season;
};

Connector.getEpisode = () => {
	if (!isEpisodeContext()) return null;
	const overlayText = getEpisodeOverlayText();
	if (!overlayText) return null;
	return parseEpisodeOverlay(overlayText).episode;
};

Connector.getCurrentTime = () => {
	const v = getMainVideoElement();
	return v && Number.isFinite(v.currentTime) ? v.currentTime : null;
};

Connector.getDuration = () => {
	const v = getMainVideoElement();
	return v && Number.isFinite(v.duration) ? v.duration : null;
};

Connector.isPlaying = () => {
	const v = getMainVideoElement();
	return !!v && !v.paused && !v.ended;
};

Connector.getOriginUrl = () => window.location.href;

Connector.getUniqueID = () => {
	const m = watchUrlRegex.exec(window.location.pathname);
	return m?.groups?.id ?? null;
};
