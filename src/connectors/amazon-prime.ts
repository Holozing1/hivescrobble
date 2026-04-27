/**
 * Amazon Prime Video connector — long-form video scrobbler for the Hive
 * integration. Most fragile of the four: Amazon's player exposes title
 * info through obfuscated player state and selectors change frequently.
 *
 * Episode titles often missing entirely — when only an "S1 E3" marker is
 * visible without a per-episode title, we report just the series + S/E
 * and let TMDB resolve the canonical episode title.
 */

export {};

Connector.playerSelector = '.atvwebplayersdk-overlays-container, video';

Connector.isVideo = () => true;

function getMainVideoElement(): HTMLVideoElement | null {
	const videos = Array.from(document.querySelectorAll('video'));
	if (videos.length === 0) return null;
	return videos.reduce((biggest, candidate) =>
		candidate.duration > (biggest.duration || 0) ? candidate : biggest,
	);
}

const TITLE_SELECTORS = [
	'.atvwebplayersdk-title-text',
	'[class*="title-text"]',
	'h1.title',
];

const SUBTITLE_SELECTORS = [
	'.atvwebplayersdk-subtitle-text',
	'[class*="subtitle-text"]',
];

function findText(selectors: string[]): string | null {
	for (const sel of selectors) {
		const el = document.querySelector(sel) as HTMLElement | null;
		const text = el?.textContent?.trim();
		if (text) return text;
	}
	return null;
}

interface ParsedSubtitle {
	season: number | null;
	episode: number | null;
	episodeTitle: string | null;
}

function parseSubtitle(subtitle: string | null): ParsedSubtitle {
	if (!subtitle) return { season: null, episode: null, episodeTitle: null };
	// Amazon variants:
	//   "S1 E3 The Pilot"
	//   "Season 1, Episode 3"
	//   "S1, Ep. 3"
	const concise =
		/S(\d+)[,\s]*(?:Ep\.?\s*|E\s*)(\d+)\s*[·:.\-]?\s*(.*)$/i.exec(subtitle);
	if (concise) {
		return {
			season: parseInt(concise[1], 10),
			episode: parseInt(concise[2], 10),
			episodeTitle: concise[3].trim() || null,
		};
	}
	const verbose =
		/Season\s+(\d+)[,\s]+Episode\s+(\d+)\s*[·:.\-]?\s*(.*)$/i.exec(subtitle);
	if (verbose) {
		return {
			season: parseInt(verbose[1], 10),
			episode: parseInt(verbose[2], 10),
			episodeTitle: verbose[3].trim() || null,
		};
	}
	return { season: null, episode: null, episodeTitle: subtitle };
}

function isEpisode(): boolean {
	const sub = findText(SUBTITLE_SELECTORS);
	if (!sub) return false;
	return /S\d+|Season\s+\d+|Episode\s+\d+|Ep\.?\s*\d+/i.test(sub);
}

Connector.getVideoKind = () => (isEpisode() ? 'episode' : 'movie');

Connector.getTrack = () => {
	if (isEpisode()) {
		const parsed = parseSubtitle(findText(SUBTITLE_SELECTORS));
		if (parsed.episodeTitle) return parsed.episodeTitle;
		// Fallback when Amazon doesn't surface the episode title — use the
		// series title plus marker so we have *something* to show pre-TMDB.
		const series = findText(TITLE_SELECTORS);
		if (series && parsed.season && parsed.episode) {
			return `${series} S${parsed.season}E${parsed.episode}`;
		}
	}
	return findText(TITLE_SELECTORS);
};

Connector.getArtist = () => (isEpisode() ? findText(TITLE_SELECTORS) : null);

Connector.getSeriesTitle = () => (isEpisode() ? findText(TITLE_SELECTORS) : null);

Connector.getSeason = () => parseSubtitle(findText(SUBTITLE_SELECTORS)).season;
Connector.getEpisode = () => parseSubtitle(findText(SUBTITLE_SELECTORS)).episode;

Connector.getAlbum = () => {
	const season = parseSubtitle(findText(SUBTITLE_SELECTORS)).season;
	return season ? `Season ${season}` : null;
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
	// Amazon Prime player URLs:
	//   /detail/<asin>/...
	//   /gp/video/detail/<asin>/...
	const match = /\/detail\/([A-Z0-9]+)/i.exec(window.location.pathname);
	return match?.[1] ?? null;
};
