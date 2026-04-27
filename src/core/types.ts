import type { DisallowedReason } from './object/disallowed-reason';

export interface TimeInfo {
	/**
	 * Currentime in seconds
	 */
	currentTime?: number;

	/**
	 * Duration in seconds
	 */
	duration?: number;
}

export interface ArtistTrackInfo {
	/**
	 * Artist name
	 */
	artist?: string | null;

	/**
	 * Track name
	 */
	track?: string | null;
}

export interface TrackInfoWithAlbum extends ArtistTrackInfo {
	/**
	 * Album name
	 */
	album?: string | null;
}

export interface BaseState extends TrackInfoWithAlbum {
	/**
	 * URL to track art image.
	 */
	trackArt?: string | null;
}

export interface State extends BaseState {
	/**
	 * Album artist.
	 */
	albumArtist?: string | null;

	/**
	 * Track unique ID.
	 */
	uniqueID?: string | null;

	/**
	 * Track duration.
	 */
	duration?: number | null;

	/**
	 * Current time.
	 */
	currentTime?: number | null;

	/**
	 * Playing/pause state.
	 */
	isPlaying?: boolean | null;

	/**
	 * Whether the current track is a podcast episode.
	 */
	isPodcast?: boolean | null;

	/**
	 * Whether the current track is a non-music video (e.g. YouTube Entertainment
	 * category). Distinct from isPodcast — a true value means "treat as video".
	 */
	isVideo?: boolean | null;

	/**
	 * For long-form video (movie/TV episode) scrobbles. When set, the kind
	 * field on the broadcast payload uses 'movie' or 'episode' instead of
	 * 'song'/'video'/'podcast'. The connector populates basics directly;
	 * the metadata pipeline stage enriches `wikipediaUrl` / `imdbId` /
	 * `seriesWikipediaUrl` / `seriesImdbId` after the fact via Wikipedia
	 * + Wikidata.
	 */
	videoKind?: 'movie' | 'episode' | null;
	wikipediaUrl?: string | null;
	seriesWikipediaUrl?: string | null;
	imdbId?: string | null;
	seriesImdbId?: string | null;
	year?: number | null;
	season?: number | null;
	episode?: number | null;
	seriesTitle?: string | null;

	/**
	 * Origin URL.
	 */
	originUrl?: string | null;

	/**
	 * Is scrobbling allowed
	 */
	scrobblingDisallowedReason?: DisallowedReason | null;
}
