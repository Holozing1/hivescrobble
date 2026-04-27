import type Song from '@/core/object/song';
import {
	getImdbId,
	getSummary,
	searchCandidates,
} from '@/core/object/wikipedia-api';
import { debugLog } from '@/core/content/util';
import { timeoutPromise } from '@/util/util';

/**
 * Pipeline stage that enriches video scrobbles (movie/TV episode) with
 * canonical metadata from Wikipedia + Wikidata. No-op for music.
 *
 * Replaces the prior TMDB pipeline (deleted 2026-04-26 along with
 * core/object/tmdb-api.ts) — Wikipedia is free for any use, TMDB charges
 * for commercial which would have blocked Hobbles' public launch.
 *
 * Inputs (set by the connector on song.parsed):
 *   videoKind: 'movie' | 'episode'
 *   track: movie/episode title
 *   seriesTitle: series title (for episodes)
 *   season, episode: numbers (for episodes; may be missing)
 *   year: release year (for movies; may be missing)
 *
 * Outputs (mutated on song.parsed):
 *   wikipediaUrl: canonical Wikipedia URL for movie or series
 *   imdbId: IMDb ID via Wikidata SPARQL (best-effort, optional)
 *   year: canonicalized from Wikipedia if missing
 *   trackArt: poster/still URL from REST summary if not already set
 *
 * Lookup is best-effort: the scrobble still broadcasts even when nothing
 * resolves — it just carries fewer canonical references.
 */

const REQUEST_TIMEOUT = 8000;

export async function process(song: Song): Promise<void> {
	const parsed = song.parsed;
	if (!parsed.isVideo || !parsed.videoKind) return;
	if (parsed.wikipediaUrl) return; // already resolved
	if (song.isEmpty?.()) return;

	try {
		if (parsed.videoKind === 'movie') {
			await resolveMovie(song);
		} else {
			await resolveEpisode(song);
		}
	} catch (err) {
		debugLog(`Wikipedia resolution failed: ${(err as Error).message}`, 'warn');
	}
}

async function resolveMovie(song: Song): Promise<void> {
	const title = song.parsed.track;
	if (!title) return;

	const candidates = await timeoutPromise(REQUEST_TIMEOUT, searchCandidates('movie', title));
	if (!candidates || candidates.length === 0) return;

	// Prefer year-matching candidate when the connector had a year.
	const wantedYear = song.parsed.year ?? undefined;
	const picked = (wantedYear
		? candidates.find((c) => c.year === wantedYear)
		: undefined) ?? candidates[0];

	const summary = await timeoutPromise(REQUEST_TIMEOUT, getSummary(picked.title));
	if (!summary) return;

	song.parsed.wikipediaUrl = summary.url;
	if (!song.parsed.year && summary.year) {
		song.parsed.year = summary.year;
	}
	if (!song.parsed.trackArt) {
		song.parsed.trackArt = summary.originalImageUrl ?? summary.thumbnailUrl ?? null;
	}

	// IMDb cross-ref via Wikidata — best-effort, fire-and-forget.
	const imdb = await timeoutPromise(REQUEST_TIMEOUT, getImdbId(picked.title));
	if (imdb) song.parsed.imdbId = imdb;
}

async function resolveEpisode(song: Song): Promise<void> {
	const seriesTitle = song.parsed.seriesTitle ?? song.parsed.artist;
	if (!seriesTitle) return;

	const candidates = await timeoutPromise(
		REQUEST_TIMEOUT,
		searchCandidates('episode', seriesTitle),
	);
	if (!candidates || candidates.length === 0) return;

	const picked = candidates[0];
	const summary = await timeoutPromise(REQUEST_TIMEOUT, getSummary(picked.title));
	if (!summary) return;

	song.parsed.seriesWikipediaUrl = summary.url;
	if (!song.parsed.year && summary.year) {
		song.parsed.year = summary.year;
	}
	if (!song.parsed.trackArt) {
		song.parsed.trackArt = summary.originalImageUrl ?? summary.thumbnailUrl ?? null;
	}

	const imdb = await timeoutPromise(REQUEST_TIMEOUT, getImdbId(picked.title));
	if (imdb) song.parsed.seriesImdbId = imdb;

	// Wikipedia doesn't have a structured per-episode lookup the way TMDB
	// did. The connector's parsed season/episode numbers are kept on the
	// payload as-is; an indexer can resolve canonical episode title later
	// (e.g. from the show's "List of episodes" Wikipedia page) if needed.
	// We don't block the scrobble waiting for that.
}
