'use strict';

export type ScrobbleKind = 'song' | 'podcast' | 'video' | 'movie' | 'episode';

/**
 * Single broadcast payload shape covering both audio (song/podcast/video)
 * and visual long-form (movie/episode) scrobbles.
 *
 * Indexers filter on `kind` to route a given scrobble. Music-side fields
 * (artist/album/duration) are populated for kind in {song, podcast, video};
 * video-side fields (tmdb_id/year/season/episode_number/series_*) are
 * populated for kind in {movie, episode}. The base envelope (app,
 * timestamp, url, percent_played, platform) is shared.
 */
export interface HiveScrobblePayload {
	app: string;
	timestamp: string;
	kind: ScrobbleKind;

	// Title carries both song titles and movie/episode titles.
	title: string;

	// Music-side
	artist?: string;
	album?: string;
	duration?: string;

	// Shared envelope
	percent_played?: number;
	platform?: string;
	url?: string;

	// Video/movie/episode-side. Wikipedia URL is the canonical reference;
	// IMDb ID is a best-effort cross-ref from Wikidata. tmdb_id/
	// series_tmdb_id are kept for backward-read of pre-2026-04-26 scrobbles
	// from the previous TMDB-based pipeline; new writes don't populate them.
	wikipedia_url?: string;
	series_wikipedia_url?: string;
	imdb_id?: string;
	series_imdb_id?: string;
	tmdb_id?: number;
	series_tmdb_id?: number;
	year?: number;
	season?: number;
	episode_number?: number;
	series_title?: string;

	// Poster / artwork URL — populated for movie/episode broadcasts so
	// zingit-web feed cards render without a separate metadata fetch.
	poster_url?: string;
}
