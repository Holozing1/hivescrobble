/**
 * Disney+ connector — long-form video scrobbler for the Hive integration.
 *
 * Disney+ uses heavily React-rendered UI; selectors are A/B-tested and
 * change every couple of months. Selectors here cover the variants seen
 * as of 2026-04. If scrobbles stop landing, check the player title /
 * subtitle DOM with devtools and update the selector arrays.
 *
 * Movie vs episode detection: episodes have a non-empty subtitle line
 * ("S1: E3 The Pilot" or similar). Movies have just the main title.
 */

export {};

Connector.playerSelector = '[data-testid="player"], .btm-media-overlays-container, video';

Connector.isVideo = () => true;

const TITLE_SELECTORS = [
	'[data-testid="title-display"]',
	'.title-field',
	'.heading-1',
	'.btm-media-client-overlay h1',
];

const SUBTITLE_SELECTORS = [
	'[data-testid="subtitle-display"]',
	'.subtitle-field',
	'.btm-media-client-overlay h2',
];

function getMainVideoElement(): HTMLVideoElement | null {
	const videos = Array.from(document.querySelectorAll('video'));
	if (videos.length === 0) return null;
	return videos.reduce((biggest, candidate) =>
		candidate.duration > (biggest.duration || 0) ? candidate : biggest,
	);
}

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
	// Examples observed: "S1: E3 The Pilot", "Season 1 · Episode 3 · The Pilot"
	const concise = /S(\d+)\s*[:.]?\s*E(\d+)\s*[·:.\-]?\s*(.*)$/i.exec(subtitle);
	if (concise) {
		return {
			season: parseInt(concise[1], 10),
			episode: parseInt(concise[2], 10),
			episodeTitle: concise[3].trim() || null,
		};
	}
	const verbose = /Season\s+(\d+).*Episode\s+(\d+)\s*[·:.\-]?\s*(.*)$/i.exec(subtitle);
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
	return /S\d+|Season\s+\d+|Episode\s+\d+/i.test(sub);
}

Connector.getVideoKind = () => (isEpisode() ? 'episode' : 'movie');

Connector.getTrack = () => {
	if (isEpisode()) {
		const parsed = parseSubtitle(findText(SUBTITLE_SELECTORS));
		if (parsed.episodeTitle) return parsed.episodeTitle;
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
	// Disney+ player URL forms vary: /video/<uuid>, /play/<uuid>, /movies/<slug>/<id>.
	const match = /\/(?:video|play)\/([a-zA-Z0-9-]+)/.exec(window.location.pathname);
	return match?.[1] ?? null;
};
