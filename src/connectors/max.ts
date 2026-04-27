/**
 * Max (formerly HBO Max) connector — long-form video scrobbler for the
 * Hive integration. Covers max.com and the legacy hbomax.com / hbo.com
 * domains.
 *
 * Max uses a clean React app post-rebrand; the player chrome is partially
 * shadow-DOM'd but document.title and ARIA labels reliably surface the
 * playing content. URLs don't expose a stable content ID, so we lean on
 * TMDB resolution by title for the canonical reference.
 */

export {};

Connector.playerSelector = '[data-testid="player"], video';

Connector.isVideo = () => true;

function getMainVideoElement(): HTMLVideoElement | null {
	const videos = Array.from(document.querySelectorAll('video'));
	if (videos.length === 0) return null;
	return videos.reduce((biggest, candidate) =>
		candidate.duration > (biggest.duration || 0) ? candidate : biggest,
	);
}

function getTitleParts(): { title: string | null; subtitle: string | null } {
	// Max sets document.title to "Show / Movie | Max" during playback.
	// Subtitle (S/E info) lives in ARIA labels on the player chrome.
	const docTitle = document.title.replace(/\s*\|\s*Max\s*$/, '').trim();

	// The seek bar typically has an aria-label like "Season 1, Episode 3, The Pilot"
	const ariaSeekBar = document.querySelector(
		'[aria-label*="Episode"], [aria-label*="Season"]',
	) as HTMLElement | null;
	const ariaText = ariaSeekBar?.getAttribute('aria-label') ?? null;

	// Visible overlay variants
	const overlayTitle = document.querySelector(
		'[data-testid="title"], h1[class*="title"]',
	) as HTMLElement | null;
	const overlaySub = document.querySelector(
		'[data-testid="subtitle"], h2[class*="subtitle"]',
	) as HTMLElement | null;

	return {
		title: overlayTitle?.textContent?.trim() || docTitle || null,
		subtitle: overlaySub?.textContent?.trim() || ariaText || null,
	};
}

interface ParsedSubtitle {
	season: number | null;
	episode: number | null;
	episodeTitle: string | null;
}

function parseSubtitle(subtitle: string | null): ParsedSubtitle {
	if (!subtitle) return { season: null, episode: null, episodeTitle: null };
	const verbose =
		/Season\s+(\d+)[,\s]+Episode\s+(\d+)[,\s:.\-]+(.*)$/i.exec(subtitle);
	if (verbose) {
		return {
			season: parseInt(verbose[1], 10),
			episode: parseInt(verbose[2], 10),
			episodeTitle: verbose[3].trim() || null,
		};
	}
	const concise = /S(\d+)\s*[:.\-]?\s*E(\d+)\s*[·:.\-]?\s*(.*)$/i.exec(subtitle);
	if (concise) {
		return {
			season: parseInt(concise[1], 10),
			episode: parseInt(concise[2], 10),
			episodeTitle: concise[3].trim() || null,
		};
	}
	return { season: null, episode: null, episodeTitle: subtitle };
}

function isEpisode(): boolean {
	const { subtitle } = getTitleParts();
	if (!subtitle) return false;
	return /S\d+|Season\s+\d+|Episode\s+\d+/i.test(subtitle);
}

Connector.getVideoKind = () => (isEpisode() ? 'episode' : 'movie');

Connector.getTrack = () => {
	if (isEpisode()) {
		const parsed = parseSubtitle(getTitleParts().subtitle);
		if (parsed.episodeTitle) return parsed.episodeTitle;
	}
	return getTitleParts().title;
};

Connector.getArtist = () => (isEpisode() ? getTitleParts().title : null);

Connector.getSeriesTitle = () => (isEpisode() ? getTitleParts().title : null);

Connector.getSeason = () => parseSubtitle(getTitleParts().subtitle).season;
Connector.getEpisode = () => parseSubtitle(getTitleParts().subtitle).episode;

Connector.getAlbum = () => {
	const season = parseSubtitle(getTitleParts().subtitle).season;
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
	const match = /\/video\/(?:watch|play)\/([a-zA-Z0-9-]+)/.exec(window.location.pathname);
	return match?.[1] ?? null;
};
