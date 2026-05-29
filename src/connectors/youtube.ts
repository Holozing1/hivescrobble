import type { ArtistTrackInfo, TrackInfoWithAlbum } from '@/core/types';

export {};

/**
 * Quick links to debug and test the connector:
 *
 * https://www.youtube.com/watch?v=WA3hL4hDx9c - auto-generated music video
 * The connector should get info via `getTrackInfoFromDescription` function
 *
 * https://www.youtube.com/watch?v=eYLbteOm42k - video with chapters available
 * The connector should get info via `getTrackInfoFromChapters` function
 *
 * https://www.youtube.com/watch?v=mHnC_vELJsk - regular video
 * The connector should get info via `getTrackInfoFromTitle` function
 */

/**
 * CSS selector of video element. It's common for both players.
 */
const videoSelector = '.html5-main-video';

const chapterNameSelector = '.html5-video-player .ytp-chapter-title-content';
const videoTitleSelector = [
	'.html5-video-player .ytp-title-link',
	'.slim-video-information-title .yt-core-attributed-string',
];
const channelNameSelector = [
	'#top-row .ytd-channel-name a',
	'.slim-owner-channel-name .yt-core-attributed-string',
];
const videoDescriptionSelector = [
	'#description.ytd-expandable-video-description-body-renderer',
	'#meta-contents #description',
	'.crawler-full-description',
];

// Dummy category indicates an actual category is being fetched
const categoryPending = 'YT_DUMMY_CATEGORY_PENDING';
// Fallback value in case when we cannot fetch a category.
const categoryUnknown = 'YT_DUMMY_CATEGORY_UNKNOWN';

const categoryMusic = 'Music';
const categoryEntertainment = 'Entertainment';

/**
 * Array of categories allowed to be scrobbled.
 */
const allowedCategories: string[] = [];

/**
 * "Video Id=Category" map.
 */
const categoryCache = new Map<string, string>();

/**
 * Wether we should only scrobble music recognised by YouTube Music
 */
let scrobbleMusicRecognisedOnly = false;
// When YT Music doesn't recognise a video as music, treat it as a video
// scrobble (kind=video) instead of blocking. Off → legacy block-only.
let scrobbleNonMusicVideos = true;

/**
 * Wether the Youtube Music track info getter is enabled
 */
let getTrackInfoFromYtMusicEnabled = false;

// Always consult YouTube Music's recognition (videoDetails.musicVideoType)
// for the music-vs-video decision in isVideo(), independent of the track-info
// getter flag above. This is the authoritative "is this a music recording?"
// signal — YouTube's own Content-ID match — and it fires even for re-uploads
// on non-VEVO channels (the case heuristics miss most). On by default; the
// per-video lookup is cached. Track-info *extraction* stays gated by the flag
// above (kept conservative — only OMV-typed videos yield a title/artist).
const classifyWithYtMusic = true;

let currentVideoDescription: string | null = null;
let artistTrackFromDescription: TrackInfoWithAlbum | null = null;

const getTrackInfoFromYoutubeMusicCache: {
	[videoId: string]: {
		done?: boolean;
		recognisedByYtMusic?: boolean;
		videoId?: string | null;
		currentTrackInfo?: { artist?: string; track?: string };
	};
} = {};

const trackInfoGetters: (() =>
	| ArtistTrackInfo
	| null
	| undefined
	| Record<string, never>
	| TrackInfoWithAlbum)[] = [
	getTrackInfoFromChapters,
	getTrackInfoFromYoutubeMusic,
	getTrackInfoFromDescription,
	getTrackInfoFromTitle,
];

readConnectorOptions();
setupEventListener();

Connector.playerSelector = ['#content', '#player'];

Connector.scrobbleInfoLocationSelector = '#primary #title.ytd-watch-metadata';
Connector.scrobbleInfoStyle = {
	...Connector.scrobbleInfoStyle,
	fontSize: '1.17em',
	fontWeight: '700',
};

Connector.loveButtonSelector =
	'ytd-watch-metadata like-button-view-model button[aria-pressed="false"]';

Connector.unloveButtonSelector =
	'ytd-watch-metadata like-button-view-model button[aria-pressed="true"]';

Connector.getChannelId = () =>
	new URL(
		(
			Util.queryElements([
				'#upload-info .ytd-channel-name .yt-simple-endpoint',
				'.slim-owner-icon-and-title',
			]) as NodeListOf<HTMLAnchorElement>
		)?.[0]?.href ?? 'https://youtube.com/',
	).pathname.slice(1);

Connector.channelLabelSelector = [
	'#primary #title+#top-row ytd-channel-name .yt-formatted-string',
	'.slim-owner-icon-and-title .yt-core-attributed-string',
];

Connector.getTrackInfo = () => {
	const trackInfo: TrackInfoWithAlbum = {};

	if (getTrackInfoFromYtMusicEnabled) {
		const videoId = getVideoId();
		if (!getTrackInfoFromYoutubeMusicCache[videoId ?? '']) {
			// start loading getTrackInfoFromYoutubeMusic
			getTrackInfoFromYoutubeMusic();

			// wait for getTrackInfoFromYoutubeMusic to finish
			return trackInfo;
		}
	}

	for (const getter of trackInfoGetters) {
		const currentTrackInfo = getter();
		if (!currentTrackInfo) {
			continue;
		}

		if (!trackInfo.artist) {
			trackInfo.artist = currentTrackInfo.artist;
		}

		if (!trackInfo.track) {
			trackInfo.track = currentTrackInfo.track;
		}

		if (!trackInfo.album && 'album' in currentTrackInfo) {
			trackInfo.album = currentTrackInfo.album;
		}

		if (!Util.isArtistTrackEmpty(trackInfo)) {
			break;
		}
	}

	return trackInfo;
};

Connector.getTimeInfo = () => {
	const videoElement = document.querySelector(
		videoSelector,
	) as HTMLVideoElement;
	if (videoElement && !areChaptersAvailable()) {
		let { currentTime, duration, playbackRate } = videoElement;

		currentTime /= playbackRate;
		duration /= playbackRate;

		return { currentTime, duration };
	}

	return null;
};

Connector.isPlaying = () => {
	return Util.hasElementClass('.html5-video-player', 'playing-mode');
};

Connector.getOriginUrl = () => {
	const videoId = getVideoId();

	return `https://youtu.be/${videoId}`;
};

// Title/channel-based override that flips isVideo()=true when a video looks
// like non-music content even if YouTube's `category` metadata says Music
// or is unreachable. Category is set by the uploader and isn't reliable —
// a movie studio uploads a trailer to a music-categorised channel, a
// gaming channel mislabels itself, the category fetch times out, etc.
//
// Two tiers of detection:
//
//   * Strong title patterns ("Official Trailer", "Tier List", "Let's Play")
//     fire alone — these almost never appear in real song titles, so the
//     false-positive risk is acceptable.
//   * Weak title keywords ("trailer", "teaser", "review", "podcast") fire
//     only when paired with a non-music channel signal — covers cases
//     where the title alone is ambiguous ("Teaser" by Twice is a song;
//     "Teaser" uploaded by Marvel Entertainment is not).
//
// When extending: prefer adding strong patterns over weak ones. A song
// being misclassified as video is annoying but recoverable; the reverse
// is the bug we're fixing here. Keep this in sync with the streamer-side
// regex in zingit-web/lib/hive-scrobbles.ts (LOOKS_LIKE_VIDEO_RE) so the
// ISRC auto-correction respects the same classifications.
const STRONG_NON_MUSIC_TITLE_PATTERNS: RegExp[] = [
	// Movie / TV trailers
	/\bofficial\s+trailer\b/i,
	/\bteaser\s+trailer\b/i,
	/\bfinal\s+trailer\b/i,
	/\b(red|green)\s+band\s+trailer\b/i,
	/\bfirst\s+look\s+trailer\b/i,
	/\bnew\s+trailer\b/i,
	/\bmovie\s+trailer\b/i,
	/\bextended\s+trailer\b/i,
	/\btv\s+spot\b/i,
	// Reactions, reviews, rankings
	/\breact(ing|s|ion)\s+to\b/i,
	/\btier\s+list\b/i,
	/\btop\s+\d+\s+(best|worst|greatest)\b/i,
	// Gaming — generic verbs
	/\blet'?s\s+play\b/i,
	/\bplaythrough\b/i,
	/\bwalkthrough\b/i,
	/\bspeedrun\b/i,
	/\bworld\s+record\b/i,
	/\bgameplay\s+(trailer|walkthrough|preview)\b/i,
	// Gaming — common game titles. Anything containing these strongly
	// implies gaming content even on a channel with miscategorised
	// metadata (e.g. shroud's Counter-Strike highlights uploaded under
	// a non-Gaming YouTube category).
	/\bcounter[- ]?strike\b/i,
	/\b(cs:?go|cs2)\b/i,
	/\bvalorant\b/i,
	/\bfortnite\b/i,
	/\bminecraft\b/i,
	/\bleague\s+of\s+legends\b/i,
	/\b(apex\s+legends|apex\s+gameplay)\b/i,
	/\bdota\s*2?\b/i,
	/\bcall\s+of\s+duty\b/i,
	/\b(cod\s+(warzone|mw\d+|black\s+ops))\b/i,
	/\boverwatch\s*2?\b/i,
	/\b(gta\s*[v\d]|grand\s+theft\s+auto)\b/i,
	/\bcyberpunk\s*2077\b/i,
	/\b(world\s+of\s+warcraft|wow\s+(raid|dungeon|pvp))\b/i,
	/\brocket\s+league\b/i,
	/\belden\s+ring\b/i,
	/\bzelda\b/i,
	/\bpokemon\b/i,
	/\bmario\s+(kart|party|odyssey)\b/i,
	/\bsmash\s+(bros|ultimate)\b/i,
	// Podcasts / interviews
	/\b(podcast|episode|ep)\.?\s*#?\s*\d+\b/i,
	/\bfull\s+(podcast|episode|interview)\b/i,
	/\bjoe\s+rogan\s+experience\b/i,
	// Tutorials / explanations
	/\bhow\s+to\s+\w+/i,
	/\b(tutorial|deep\s+dive|breakdown|explained)\b/i,
	// Vlogs / lifestyle
	/\bday\s+in\s+the\s+life\b/i,
	/\bvlogmas\b/i,
	// Live / streaming
	/\b(live\s+stream|livestream|streaming\s+now)\b/i,
	// Documentaries / behind-the-scenes
	/\b(behind\s+the\s+scenes|making\s+of)\b/i,
	/\bfull\s+documentary\b/i,
	// Tech / unboxings
	/\b(unboxing|hands-on\s+review)\b/i,
];

// Songs are almost always 2-7 minutes; anything dramatically longer that
// doesn't have an explicit music signal (Topic / VEVO channel, "Official
// Music Video" in title) is overwhelmingly likely to be non-music
// long-form content (gaming streams, podcasts, vlogs, full documentaries,
// talk-show clips).
//
// Two thresholds:
//   - 15 min: hard cap. Anything past this without a positive music
//     signal is treated as non-music. Catches gaming/podcast streams.
//   - 8 min: soft cap. Triggers stricter scrutiny — requires explicit
//     music signal (Topic/VEVO/Records channel, "Official Music Video"
//     etc.) before the connector accepts as music. Catches talk-show
//     clips (~8-12 min) that slip past the hard cap.
const LONG_FORM_THRESHOLD_SEC = 15 * 60;
const MEDIUM_FORM_THRESHOLD_SEC = 8 * 60;

const MUSIC_CHANNEL_HINTS = [
	/\bvevo\b/i,
	/\s+-\s+topic$/i,
	/\brecords?$/i,
	/\bofficial\s+music$/i,
];

const MUSIC_TITLE_HINTS = [
	/\bofficial\s+music\s+video\b/i,
	/\bofficial\s+(audio|video|lyric\s+video)\b/i,
	/\b(lyric|lyrics)\s+video\b/i,
	/\bremix\b/i, // remixes are generally still music
];

function looksLikeMusicSignal(
	title: string | null | undefined,
	channel: string | null | undefined,
): boolean {
	if (channel && MUSIC_CHANNEL_HINTS.some((re) => re.test(channel))) {
		return true;
	}
	if (title && MUSIC_TITLE_HINTS.some((re) => re.test(title))) {
		return true;
	}
	return false;
}

function getCurrentVideoDurationSec(): number | null {
	const v = document.querySelector(videoSelector) as HTMLVideoElement | null;
	if (!v || !isFinite(v.duration) || v.duration <= 0) {
		return null;
	}
	return v.duration / (v.playbackRate || 1);
}

const NON_MUSIC_CHANNEL_PATTERNS: RegExp[] = [
	// Movie studios + aggregators
	/movieclips/i,
	/marvel\s*(entertainment|studios)?/i,
	/warner\s+bros/i,
	/sony\s+pictures/i,
	/universal\s+pictures/i,
	/20th\s+century/i,
	/paramount\s+pictures/i,
	/lionsgate/i,
	/disney(\s|$)/i,
	/pixar/i,
	/apple\s+tv/i,
	/amazon\s+mgm/i,
	/rotten\s+tomatoes/i,
	/ign\s+movies/i,
	/fandango/i,
	/kinocheck/i,
	/netflix/i,
	/\bhbo\b/i,
	/hulu/i,
	/\ba24\b/i,
	// Late-night / talk shows. Add by show name; their official YouTube
	// uploads use these channel names exactly. Without these patterns, a
	// 10-min Late Show clip with a "Trump: ... | When ... | Don't ..." title
	// got misparsed as song "Trump — I Don't Think About Anybody".
	/\blate\s+show\b/i,
	/\btonight\s+show\b/i,
	/\bdaily\s+show\b/i,
	/\bsaturday\s+night\s+live\b/i,
	/\bsnl\b/i,
	/\blate\s+late\s+show\b/i,
	/\bjimmy\s+(kimmel|fallon)\b/i,
	/\bjames\s+corden\b/i,
	/\bconan\s+o'?brien\b/i,
	/\bstephen\s+colbert\b/i,
	/\bseth\s+meyers\b/i,
	/\btrevor\s+noah\b/i,
	/\bjohn\s+oliver\b/i,
	/\blast\s+week\s+tonight\b/i,
	// Common non-music patterns in channel names
	/\bgaming\b/i,
	/\bplays\b/i,
	/\bgameplay\b/i,
	/\bpodcast\b/i,
	/\bnews\b/i,
	/\btech\b/i,
	/\breviews?\b/i,
];

const WEAK_NON_MUSIC_TITLE_KEYWORDS =
	/\b(trailer|teaser|review|reviewing|interview|podcast|vlog|reaction|gameplay|highlights?|montage)\b/i;

// Talk-show / late-night titles almost always carry 2+ pipe separators
// (e.g. "Trump: ... | When Does The President Sleep? | Don't Worry About
// Hantavirus"). Music titles essentially never structure themselves this
// way. Three or more ` | ` chunks AND no music signal → treat as non-music.
const MULTI_PIPE_TITLE = /(?:\s\|\s.+){2,}/;

function looksLikeNonMusicVideo(
	title: string | null | undefined,
	channel: string | null | undefined,
): boolean {
	if (!title) {
		return false;
	}
	if (STRONG_NON_MUSIC_TITLE_PATTERNS.some((re) => re.test(title))) {
		return true;
	}
	if (channel && NON_MUSIC_CHANNEL_PATTERNS.some((re) => re.test(channel))) {
		return WEAK_NON_MUSIC_TITLE_KEYWORDS.test(title);
	}
	return false;
}

function getCurrentVideoTitle(): string | null {
	const el = (
		Util.queryElements(videoTitleSelector) as NodeListOf<HTMLElement>
	)?.[0];
	return el?.textContent?.trim() || null;
}

function getCurrentChannelName(): string | null {
	const el = (
		Util.queryElements(channelNameSelector) as NodeListOf<HTMLElement>
	)?.[0];
	return el?.textContent?.trim() || null;
}

// Non-music YouTube video — three independent paths return true:
//   1. title/channel matches a non-music pattern (looksLikeNonMusicVideo)
//   2. YouTube's category metadata says non-Music
//   3. duration > 15 min AND no explicit music signal in title/channel —
//      catches long-form content (gaming streams, podcasts, vlogs) that
//      slips through the keyword list. The "no music signal" guard
//      prevents false positives on extended remixes / DJ sets that are
//      genuinely music.
//
// Returns false during the brief window after page load while category
// fetches; controller re-reads state on later ticks, so it flips once
// the cache fills.
Connector.isVideo = () => {
	const title = getCurrentVideoTitle();
	const channel = getCurrentChannelName();
	if (looksLikeNonMusicVideo(title, channel)) {
		return true;
	}

	// YouTube Music recognition (Content-ID musicVideoType) — the
	// authoritative "is this a music recording?" signal. Trust it over the
	// weaker category/duration/channel heuristics below: it rescues real
	// songs they'd mis-flag as video (a track on a personal/non-VEVO channel,
	// a long song/mix/DJ set). POSITIVE-ONLY — absence of recognition does
	// NOT imply non-music (indie/live tracks aren't in YT Music's graph), so
	// we fall through when unrecognised. Runs AFTER the strong non-music
	// patterns above so a "X reaction"/"official trailer" that picks up a UGC
	// audio match still stays video. Kicks the lookup once per video
	// (idempotent + cached); fills on a later tick if still pending.
	getTrackInfoFromYoutubeMusic();
	const ytMusic = getTrackInfoFromYoutubeMusicCache[getVideoId() ?? ''];
	if (ytMusic?.done && ytMusic.recognisedByYtMusic) {
		return false;
	}

	const category = getVideoCategory();
	if (
		category != null &&
		category !== categoryPending &&
		category !== categoryMusic
	) {
		return true;
	}

	const durationSec = getCurrentVideoDurationSec();
	if (durationSec != null && durationSec > LONG_FORM_THRESHOLD_SEC) {
		if (!looksLikeMusicSignal(title, channel)) {
			return true;
		}
	}

	// Medium-form gate: 8-15 min clips need a positive music signal to
	// be accepted. Catches talk-show / late-night clips that slip past
	// the 15-min hard cap with titles parseable as song-like strings.
	if (durationSec != null && durationSec > MEDIUM_FORM_THRESHOLD_SEC) {
		if (!looksLikeMusicSignal(title, channel)) {
			return true;
		}
	}

	// Multi-pipe title heuristic — talk-show formats almost always
	// chain 2+ pipe-separated segments, music titles essentially never
	// do. Treat as non-music when both signals match.
	if (
		title &&
		MULTI_PIPE_TITLE.test(title) &&
		!looksLikeMusicSignal(title, channel)
	) {
		return true;
	}

	return false;
};

Connector.getTrackArt = () => {
	const videoId = getVideoId();
	return videoId
		? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
		: null;
};

Connector.getUniqueID = () => {
	if (areChaptersAvailable()) {
		return null;
	}

	return getVideoId();
};

Connector.scrobblingDisallowedReason = () => {
	if (document.querySelector('.ad-showing')) {
		return 'IsAd';
	}

	// Workaround to prevent scrobbling the video opened in a background tab.
	if (!isVideoStartedPlaying()) {
		return 'Other';
	}

	if (scrobbleMusicRecognisedOnly) {
		const videoId = getVideoId();
		const ytMusicCache = getTrackInfoFromYoutubeMusicCache[videoId ?? ''];

		if (!ytMusicCache) {
			// start loading getTrackInfoFromYoutubeMusic
			getTrackInfoFromYoutubeMusic();
			return 'IsLoading';
		}

		if (!ytMusicCache.done) {
			// not done loading yet
			return 'IsLoading';
		}

		if (!ytMusicCache.recognisedByYtMusic) {
			// Not recognised as music by YT Music. If this video also lives in
			// a non-music category (Entertainment, Comedy, News, etc.) and
			// scrobbleNonMusicVideos is on, fall through — Connector.isVideo()
			// returns true for non-music categories, so the hive scrobbler
			// will tag it as kind=video and it'll land in the videos history
			// instead of polluting the music feed.
			const category = getVideoCategory();
			const isNonMusicCategory =
				category != null &&
				category !== categoryPending &&
				category !== categoryMusic;
			if (!(scrobbleNonMusicVideos && isNonMusicCategory)) {
				return 'NotOnYouTubeMusic';
			}
		}
	}

	return isVideoCategoryAllowed() ? null : 'ForbiddenYouTubeCategory';
};

Connector.applyFilter(
	MetadataFilter.createYouTubeFilter().append({
		artist: [removeLtrRtlChars, removeNumericPrefix],
		track: [removeLtrRtlChars, removeNumericPrefix, removeQualitySuffix],
	}),
);

function setupEventListener() {
	document
		.querySelector(videoSelector)
		?.addEventListener('timeupdate', Connector.onStateChanged);
}

function areChaptersAvailable() {
	const text = Util.getTextFromSelectors(chapterNameSelector);

	// SponsorBlock extension hijacks chapter element. Ignore it.
	if (
		document.querySelector(
			'.ytp-chapter-title-content.sponsorBlock-segment-title',
		)
	) {
		return false;
	}

	if (text) {
		// YouTube introduced putting text into the current chapter element for
		// referring users to the timeline ("In this video"). hard to check for
		// because that text gets translated, we can however check if the
		// description has a chapter like that, if not it's not a real chapter
		if (
			!document.querySelector(
				`.ytd-watch-metadata ytd-macro-markers-list-item-renderer #details:has([title="${CSS.escape(text)}"]):has(#time)`,
			)
		) {
			return false;
		}
	}

	// Return the text if no sponsorblock text.
	return text;
}

function getVideoId() {
	/*
	 * ytd-watch-flexy element contains ID of a first played video
	 * if the miniplayer is visible, so we should check
	 * if URL of a current video in miniplayer is accessible.
	 */
	const miniPlayerVideoUrl = Util.getAttrFromSelectors(
		'ytd-miniplayer[active] [selected] a',
		'href',
	);
	if (miniPlayerVideoUrl) {
		return Util.getYtVideoIdFromUrl(miniPlayerVideoUrl);
	}

	const videoIDDesktop = Util.getAttrFromSelectors(
		'ytd-watch-flexy',
		'video-id',
	);
	if (videoIDDesktop) {
		return videoIDDesktop;
	}

	// as a fallback on mobile, try to get the video ID from the URL
	const videoIDMobile = new URLSearchParams(window.location.search).get('v');
	return videoIDMobile;
}

function getVideoCategory() {
	const videoId = getVideoId();

	if (!videoId) {
		return null;
	}

	if (categoryCache.has(videoId)) {
		return categoryCache.get(videoId);
	}

	/*
	 * Add dummy category for videoId to prevent
	 * fetching category multiple times.
	 */
	categoryCache.set(videoId, categoryPending);

	fetchCategoryName(videoId)
		.then((category) => {
			Util.debugLog(`Fetched category for ${videoId}: ${category}`);
			categoryCache.set(videoId, category);
		})
		.catch((err) => {
			Util.debugLog(
				`Failed to fetch category for ${videoId}: ${err}`,
				'warn',
			);
			categoryCache.set(videoId, categoryUnknown);
		});

	return null;
}

async function fetchCategoryName(videoId: string) {
	/*
	 * We cannot use `location.href`, since it could miss the video URL
	 * in case when YouTube mini player is visible.
	 */
	const videoUrl = `${location.origin}/watch?v=${videoId}`;

	try {
		/*
		 * Category info is not available via DOM API, so we should search it
		 * in a page source.
		 *
		 * But we cannot use `document.documentElement.outerHtml`, since it
		 * is not updated on video change.
		 */
		const response = await fetch(videoUrl);
		const rawHtml = await response.text();

		const categoryMatch = rawHtml.match(/"category":"(.+?)"/);
		if (categoryMatch !== null) {
			return categoryMatch[1];
		}
	} catch {
		// Do nothing
	}

	return categoryUnknown;
}

/**
 * Asynchronously read connector options.
 */
async function readConnectorOptions() {
	if (await Util.getOption('YouTube', 'scrobbleMusicOnly')) {
		allowedCategories.push(categoryMusic);
	}
	if (await Util.getOption('YouTube', 'scrobbleEntertainmentOnly')) {
		allowedCategories.push(categoryEntertainment);
	}
	Util.debugLog(`Allowed categories: ${allowedCategories.join(', ')}`);

	if (await Util.getOption('YouTube', 'scrobbleMusicRecognisedOnly')) {
		scrobbleMusicRecognisedOnly = true;
		Util.debugLog('Only scrobbling when recognised by YouTube Music');
	}

	// User can disable the non-music → kind=video routing. Defaults to true
	// (option lives in DEFAULT_CONNECTOR_OPTIONS); reading the actual stored
	// value here lets opt-outs take effect.
	scrobbleNonMusicVideos = Boolean(
		await Util.getOption('YouTube', 'scrobbleNonMusicVideos'),
	);
	Util.debugLog(
		scrobbleNonMusicVideos
			? 'Non-music YouTube videos will be scrobbled as kind=video'
			: 'Non-music YouTube videos will be ignored',
	);

	if (await Util.getOption('YouTube', 'enableGetTrackInfoFromYtMusic')) {
		getTrackInfoFromYtMusicEnabled = true;
		Util.debugLog('Get track info from YouTube Music enabled');
	}
}

function getVideoDescription() {
	return Util.getTextFromSelectors(videoDescriptionSelector)?.trim() ?? null;
}

function getTrackInfoFromDescription() {
	const description = getVideoDescription();
	if (currentVideoDescription === description) {
		return artistTrackFromDescription;
	}

	currentVideoDescription = description;
	artistTrackFromDescription = Util.parseYtVideoDescription(description);

	return artistTrackFromDescription;
}

function getTrackInfoFromYoutubeMusic():
	| ArtistTrackInfo
	| Record<string, never>
	| undefined {
	// Skip only if NEITHER the track-info getter, the recognised-only gate,
	// NOR the classification use needs it. classifyWithYtMusic keeps the
	// recognition fetch running (to populate recognisedByYtMusic for
	// isVideo) even when the track-info getter flag is off.
	if (
		!getTrackInfoFromYtMusicEnabled &&
		!scrobbleMusicRecognisedOnly &&
		!classifyWithYtMusic
	) {
		return {};
	}

	const videoId = getVideoId();

	if (!getTrackInfoFromYoutubeMusicCache[videoId ?? '']) {
		getTrackInfoFromYoutubeMusicCache[videoId ?? ''] = {
			videoId: null,
			done: false,
			currentTrackInfo: {},
		};
	} else {
		if (!getTrackInfoFromYtMusicEnabled) {
			// this means that only scrobbleMusicRecognisedOnly is enabled,
			// therefore only the cache is used and we return {} for the
			// actual getter
			return {};
		}

		if (getTrackInfoFromYoutubeMusicCache[videoId ?? ''].done) {
			// already ran!
			return getTrackInfoFromYoutubeMusicCache[videoId ?? '']
				.currentTrackInfo;
		}
		// still running, lets be patient
		return {};
	}

	const body = JSON.stringify({
		context: {
			client: {
				// parameters are needed, you get a 400 if you omit these
				// specific values are just what I got when doing a request
				// using firefox
				clientName: 'WEB_REMIX',
				clientVersion: '1.20221212.01.00',
			},
		},
		captionParams: {},
		videoId,
	});

	fetch('https://music.youtube.com/youtubei/v1/player', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body,
	})
		.then((response) => response.json())
		.then((videoInfo) => {
			// TODO: type videoInfo
			getTrackInfoFromYoutubeMusicCache[videoId ?? ''] = {
				done: true,

				recognisedByYtMusic:
					videoInfo.videoDetails?.musicVideoType?.startsWith(
						'MUSIC_VIDEO_',
					) || false,
			};

			// if videoDetails is not MUSIC_VIDEO_TYPE_OMV, it seems like it's
			// not something youtube music actually knows, so it usually gives
			// wrong results, so we only return if it is that musicVideoType
			if (
				videoInfo.videoDetails?.musicVideoType ===
				'MUSIC_VIDEO_TYPE_OMV'
			) {
				getTrackInfoFromYoutubeMusicCache[
					videoId ?? ''
				].currentTrackInfo = {
					artist: videoInfo.videoDetails.author,

					track: videoInfo.videoDetails.title,
				};
			}
		})
		.catch((err) => {
			Util.debugLog(
				`Failed to fetch youtube music data for ${videoId}: ${err}`,
				'warn',
			);
			getTrackInfoFromYoutubeMusicCache[videoId ?? ''] = {
				done: true,
				recognisedByYtMusic: false,
			};
		});
}

// Chapter names that are song *sections* rather than separate tracks.
// On a music video with structural chapters (Verse 1 / Pre-Chorus /
// Chorus / Bridge / Outro), the chapter getter would otherwise treat
// each as its own track and scrobble e.g. "Vicetone — Chorus" instead
// of "Vicetone — Nevada". Falling through to the title-based getter
// recovers the real track name.
const SONG_SECTION_NAMES =
	/^(intro|pre[-\s]?intro|verse(\s*\d+)?|pre[-\s]?chorus|chorus(\s*\d+)?|hook|drop|build([-\s]?up)?|breakdown|bridge|interlude|outro|coda|refrain|ad[-\s]?lib|instrumental|solo)$/i;

// Strong positive: title contains an explicit album / live / mix / set
// keyword. These almost always mean "this video is a compilation; each
// chapter is its own track."
const ALBUM_LIKE_TITLE =
	/(?:\bfull\s+album\b|\bthe\s+album\b|\bcomplete\s+album\b|\blive\s+(?:at|in|from|@)\b|\bconcert\b|\blive\s+(?:set|show|recording)\b|\bdj\s+set\b|\bfull\s+set\b|\bsetlist\b|\bmix(?:tape)?\b|\btracklist\b)/i;

/**
 * Decide whether the video's chapters represent *separate tracks* (an
 * album / live set / DJ mix) or *navigation markers within a single
 * piece of content* (a music video with sections, a movie with acts,
 * a tutorial with steps).
 *
 * Conservative default — only treats chapters as tracks when at least
 * one positive music-compilation signal fires. Otherwise the caller
 * falls through to the title-based getter, so the WHOLE video
 * scrobbles as one track and chapter transitions don't re-trigger.
 *
 * Fixes the dudeontheweb-reported bug where each chapter of a
 * chaptered video (e.g. a movie or tutorial) was firing a Keychain
 * prompt + notification.
 */
function chaptersLookLikeTracks(): boolean {
	const title = getCurrentVideoTitle();
	const channel = getCurrentChannelName();
	const duration = getCurrentVideoDurationSec();
	const category = getVideoCategory();

	// Strong NEGATIVES — bail out fast.
	if (looksLikeNonMusicVideo(title, channel)) {
		return false;
	}
	if (
		category != null &&
		category !== categoryPending &&
		category !== categoryMusic
	) {
		return false;
	}

	// Strong POSITIVES — title literally says "album" / "live" / "set" / "mix".
	if (title && ALBUM_LIKE_TITLE.test(title)) {
		return true;
	}

	// Duration gate: an "album" or "concert" worth chaptering is
	// almost always at least ~15 minutes. Anything shorter is much
	// more likely to be a single song with section markers OR a
	// regular video with navigation chapters.
	if (duration == null || duration < 15 * 60) {
		return false;
	}

	// Long video + recognisable music channel/title pattern = album.
	// (vevo / -topic / official music video, etc.)
	if (looksLikeMusicSignal(title, channel)) {
		return true;
	}

	// Long video + explicit YouTube "Music" category — treat as album
	// only when we've confirmed the category fetched (categoryPending
	// is a stub set before the fetch lands).
	if (category === categoryMusic) {
		return true;
	}

	// Default: chapters are navigation markers, not separate tracks.
	return false;
}

function getTrackInfoFromChapters() {
	// Short circuit if chapters not available — also dodges SponsorBlock
	// hijacking the chapter element.
	if (!areChaptersAvailable()) {
		return {
			artist: null,
			track: null,
		};
	}

	// Gate: only treat chapters as separate tracks when the video
	// looks like an album / live set / DJ mix. Otherwise the chapters
	// are navigation markers and we scrobble the whole video as one
	// track via the title-based getter (no per-chapter notifications,
	// no per-chapter Keychain prompts).
	if (!chaptersLookLikeTracks()) {
		return { artist: null, track: null };
	}

	const chapterName = Util.getTextFromSelectors(chapterNameSelector);
	// Belt-and-braces: even on a confirmed album video, a single
	// chapter labelled "Intro" / "Outro" / "Bridge" is still a section
	// label, not a track. Fall through.
	if (chapterName && SONG_SECTION_NAMES.test(chapterName.trim())) {
		return { artist: null, track: null };
	}

	const artistTrack = Util.processYtVideoTitle(chapterName);
	if (!artistTrack.track) {
		artistTrack.track = chapterName;
	}
	return artistTrack;
}

function getTrackInfoFromTitle(): ArtistTrackInfo {
	let { artist, track } = Util.processYtVideoTitle(
		Util.getTextFromSelectors(videoTitleSelector),
	);
	if (!artist) {
		artist = Util.getTextFromSelectors(channelNameSelector);
	}

	return { artist, track };
}

function removeQualitySuffix(text: string) {
	return MetadataFilter.filterWithFilterRules(text, [
		// (4K), (8K), (2K), (1K)
		{ source: /\(\s*\d[kK]\s*\)/g, target: '' },
		// (2160p), (1440p), (1080p), (720p), (480p), (360p), (240p), (144p)
		{ source: /\(\s*\d{3,4}p\s*\)/gi, target: '' },
		// trailing whitespace left behind
		{ source: /\s{2,}/g, target: ' ' },
		{ source: /\s+$/, target: '' },
	]);
}

function removeLtrRtlChars(text: string) {
	return MetadataFilter.filterWithFilterRules(text, [
		{ source: /\u200e/g, target: '' },
		{ source: /\u200f/g, target: '' },
	]);
}

function removeNumericPrefix(text: string) {
	return MetadataFilter.filterWithFilterRules(text, [
		// `NN.` or `NN)`
		{ source: /^\d{1,2}[.)]\s?/, target: '' },
		/*
		 * `(NN).` Ref: https://www.youtube.com/watch?v=KyabZRQeQgk
		 * NOTE Initial tracklist format is (NN)  dd:dd  Artist - Track
		 * YouTube adds a dot symbol after the numeric prefix.
		 */
		{ source: /^\(\d{1,2}\)\./, target: '' },
	]);
}

function isVideoStartedPlaying() {
	const videoElement = document.querySelector(
		videoSelector,
	) as HTMLVideoElement;
	return videoElement && videoElement.currentTime > 0;
}

function isVideoCategoryAllowed() {
	if (allowedCategories.length === 0) {
		return true;
	}

	const videoCategory = getVideoCategory();
	if (!videoCategory) {
		return false;
	}

	return (
		allowedCategories.includes(videoCategory) ||
		videoCategory === categoryUnknown
	);
}
