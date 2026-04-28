'use strict';

import browser from 'webextension-polyfill';
import { ServiceCallResult } from '@/core/object/service-call-result';
import type { BaseSong } from '@/core/object/song';
import type { SessionData } from '@/core/scrobbler/base-scrobbler';
import type ClonedSong from '@/core/object/cloned-song';
import BaseScrobbler from '@/core/scrobbler/base-scrobbler';
import type { HiveScrobblePayload } from '@/core/scrobbler/hive/hive.types';
import { sendBackgroundMessage } from '@/util/communication';

/** Inject hive-relay.js into the MAIN world of the given tab (on-demand). */
async function injectRelay(tabId: number): Promise<void> {
	await browser.scripting.executeScript({
		target: { tabId },
		world: 'MAIN',
		files: ['content/hive-relay.js'],
	});
}

const CUSTOM_JSON_ID = 'hive_scrobble_ai';
const APP_NAME = 'hivescrobblesai/1.0';

/**
 * Module for broadcasting scrobbles to the Hive blockchain via custom_json.
 *
 * Auth flow:
 *   1. User clicks "Connect with Keychain" in extension settings.
 *   2. Keychain popup shows — user picks their account and signs a login challenge.
 *   3. The verified username is stored in local extension storage.
 *   4. All subsequent scrobbles broadcast silently (auto-approved via Keychain).
 */
export default class HiveScrobbler extends BaseScrobbler<'Hive'> {
	public isLocalOnly = true;

	/**
	 * In-memory lock: claimed synchronously before any await so two concurrent
	 * finalize() calls in the same service worker lifecycle can't both proceed.
	 * Static so it survives across multiple HiveScrobbler instances.
	 */
	private static readonly lockedKeys = new Set<number>();

	/** Set once per SW lifetime so we sweep old keys exactly once. */
	private static prunedThisSession = false;

	/**
	 * Per-key dedup in session storage: each finalized scrobble writes its own
	 * `finalized_<startTimestamp>` key. Avoids the read-modify-write race the
	 * old shared-array approach had (two concurrent calls could both read an
	 * empty array and both proceed to broadcast).
	 */
	private storageKeyFor(key: number): string {
		return `finalized_${key}`;
	}

	private async isFinalized(key: number): Promise<boolean> {
		const sk = this.storageKeyFor(key);
		const data = await browser.storage.session.get(sk);
		return Boolean(data[sk]);
	}

	private async markFinalized(key: number): Promise<void> {
		await browser.storage.session.set({ [this.storageKeyFor(key)]: true });
	}

	/**
	 * Prune `finalized_*` entries older than 6 hours. Session storage is
	 * cleared when the browser closes, but within a long-running session a
	 * heavy listener could accumulate keys toward Chrome's ~10MB quota.
	 */
	private async pruneOldFinalizedKeys(): Promise<void> {
		try {
			const all = await browser.storage.session.get(null);
			const cutoff = Math.floor(Date.now() / 1000) - 6 * 3600;
			const toRemove: string[] = [];
			for (const k of Object.keys(all)) {
				if (!k.startsWith('finalized_')) continue;
				const ts = parseInt(k.slice('finalized_'.length), 10);
				if (!isNaN(ts) && ts < cutoff) toRemove.push(k);
			}
			if (toRemove.length) await browser.storage.session.remove(toRemove);
		} catch {
			// Pruning is best-effort; never let it break a scrobble.
		}
	}

	/** @override */
	protected getStorageName(): 'Hive' {
		return 'Hive';
	}

	/** @override */
	public getLabel(): 'Hive' {
		return 'Hive';
	}

	/** @override */
	public getStatusUrl(): string {
		return 'https://peakd.com';
	}

	/** @override */
	protected getBaseProfileUrl(): string {
		return 'https://peakd.com/@';
	}

	/** @override */
	public async getProfileUrl(): Promise<string> {
		try {
			const { sessionName } = await this.getSession();
			return sessionName ? `https://peakd.com/@${sessionName}` : '';
		} catch {
			return '';
		}
	}

	/** @override */
	public async getAuthUrl(): Promise<string> {
		return Promise.resolve('');
	}

	/** @override */
	public getSongInfo(_song: BaseSong): Promise<Record<string, never>> {
		return Promise.resolve({});
	}

	/** @override */
	public toggleLove(_song: ClonedSong, _isLoved: boolean): Promise<ServiceCallResult> {
		return Promise.resolve(ServiceCallResult.ERROR_OTHER);
	}

	/** @override */
	public async getSession(): Promise<SessionData> {
		const data = await this.storage.get();
		if (data && 'sessionID' in data && data.sessionID) {
			return {
				sessionID: data.sessionID,
				sessionName: data.sessionName,
			};
		}
		throw new Error(ServiceCallResult.ERROR_AUTH);
	}

	/** @override */
	public isReadyForGrantAccess(): Promise<boolean> {
		return Promise.resolve(false);
	}

	/** @override */
	public async sendNowPlaying(_song: BaseSong): Promise<ServiceCallResult> {
		// Don't broadcast "now playing" to the blockchain — only actual scrobbles count.
		return ServiceCallResult.RESULT_OK;
	}

	/** @override */
	public async sendResumedPlaying(_song: BaseSong): Promise<ServiceCallResult> {
		return Promise.resolve(ServiceCallResult.RESULT_OK);
	}

	/** @override */
	public async sendPaused(_song: BaseSong): Promise<ServiceCallResult> {
		return Promise.resolve(ServiceCallResult.RESULT_OK);
	}

	/** @override */
	public async scrobble(songs: BaseSong[], _currentlyPlaying: boolean): Promise<ServiceCallResult[]> {
		// Actual broadcast is deferred to finalize(), called when the song ends.
		return songs.slice(0, 50).map(() => ServiceCallResult.RESULT_OK);
	}

	/**
	 * Called when a scrobbled song or video finishes playing (via hiveFinalize message).
	 *
	 * Music branch: 1 tx at ≥60%, 2nd at ≥160% (capped at 2) for double-listens.
	 *
	 * Long-form video branch (movie/episode): single tx at ≥80% — Trakt-industry
	 * standard for "watched". Below the threshold we don't broadcast at all.
	 * Double-watch in a single playback session isn't a real thing for video.
	 */
	public async finalize(playSeconds: number, song: ClonedSong): Promise<void> {
		const key = song.metadata.startTimestamp;
		const isLongForm =
			song.parsed.videoKind === 'movie' || song.parsed.videoKind === 'episode';

		// Synchronous in-memory claim — prevents race within the same SW lifecycle.
		if (HiveScrobbler.lockedKeys.has(key)) return;
		HiveScrobbler.lockedKeys.add(key);

		// Once-per-SW-lifetime sweep of stale dedup entries.
		if (!HiveScrobbler.prunedThisSession) {
			HiveScrobbler.prunedThisSession = true;
			void this.pruneOldFinalizedKeys();
		}

		const duration = song.getDuration() ?? 0;
		const progress = duration > 0 ? playSeconds / duration : 0;

		if (isLongForm) {
			// Threshold gate — don't broadcast unwatched / abandoned views.
			if (progress < 0.8) return;

			// Content-keyed dedup so two playbacks of the same movie within
			// the same hour can't both broadcast. Hour-bucketed so legitimate
			// same-day rewatches (>1h apart) still count.
			const contentKey = this.contentDedupKey(song);
			if (await this.isFinalized(contentKey)) return;
			await this.markFinalized(contentKey);

			const percentPlayed = Math.min(100, Math.round(progress * 100));
			void this.broadcastScrobble(song, false, percentPlayed);
			return;
		}

		// Music branch — original behaviour preserved.
		if (await this.isFinalized(key)) return;
		await this.markFinalized(key);

		const txCount = Math.min(2, duration > 0 ? 1 + Math.floor(Math.max(0, progress - 0.6)) : 1);

		for (let i = 0; i < txCount; i++) {
			const percentPlayed = duration > 0
				? Math.min(100, Math.round((progress - i) * 100))
				: 0;
			void this.broadcastScrobble(song, false, percentPlayed);
		}
	}

	/**
	 * Build a dedup key for video scrobbles that survives SW restart but
	 * still allows legitimate rewatches >1h apart. Format:
	 *   v_<tmdbId | uniqueID>_<unix-hour>
	 * Keys older than 6h get pruned by pruneOldFinalizedKeys (numeric keys
	 * only — these string keys live under a separate prefix and self-expire
	 * once their hour bucket falls outside any conceivable rewatch window).
	 */
	private contentDedupKey(song: ClonedSong): number {
		// Cheap stable string → number hash so it shares the lockedKeys set.
		// Prefer canonical Wikipedia URL > IMDb ID > connector unique-ID >
		// title fallback. Whichever's present, the same content hashes
		// identically across same-hour replays.
		const id =
			song.parsed.wikipediaUrl ??
			song.parsed.imdbId ??
			song.parsed.uniqueID ??
			`${song.parsed.seriesTitle ?? ''}|${song.parsed.track ?? ''}|s${song.parsed.season ?? ''}e${song.parsed.episode ?? ''}`;
		const hourBucket = Math.floor(Date.now() / 3_600_000);
		return this.hashString(`v|${id}|${hourBucket}`);
	}

	private hashString(s: string): number {
		// djb2 — collisions are fine here; this is a dedup hint, not a security primitive.
		let hash = 5381;
		for (let i = 0; i < s.length; i++) {
			hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
		}
		// Bias into a non-overlapping range from music's startTimestamp keys
		// (which are unix seconds, well below 1e10).
		return hash + 0x4_0000_0000;
	}

	/**
	 * Verify account ownership via Keychain login and store the session.
	 * Sends a message to the content script in the given tab; the content script
	 * relays the request to the MAIN world (hive-relay.js) where window.hive_keychain lives.
	 *
	 * @param tabId - ID of an http/https tab to use for the Keychain popup
	 */
	public async connect(tabId: number): Promise<string> {
		await injectRelay(tabId);

		// Inject the bridge directly — avoids requiring the content script to be running.
		const results = await browser.scripting.executeScript({
			target: { tabId },
			world: 'ISOLATED',
			func: () =>
				new Promise<string>((resolve, reject) => {
					const id = crypto.randomUUID();
					const onMessage = (event: MessageEvent) => {
						const d = event.data as Record<string, unknown>;
						if (
							event.source !== window ||
							!d?.__hive_scrobbler ||
							d.type !== 'hiveConnectResult' ||
							d.id !== id
						) {
							return;
						}
						window.removeEventListener('message', onMessage);
						if (d.error) {
							reject(new Error(d.error as string));
						} else {
							resolve(d.username as string);
						}
					};
					window.addEventListener('message', onMessage);
					window.postMessage(
						{ __hive_scrobbler: true, type: 'hiveConnect', id },
						'*',
					);
				}),
		});

		const username = results?.[0]?.result as string | undefined;
		if (!username) {
			throw new Error(ServiceCallResult.ERROR_AUTH);
		}

		await this.storage.set({ sessionID: username, sessionName: username });
		return username;
	}

	/** Private methods */

	private async broadcastScrobble(
		song: BaseSong,
		nowPlaying: boolean,
		percentPlayed?: number,
	): Promise<ServiceCallResult> {
		let username: string;
		try {
			const session = await this.getSession();
			username = session.sessionID;
		} catch {
			return ServiceCallResult.ERROR_AUTH;
		}

		const clonedSong = song as ClonedSong;
		const tabId = clonedSong?.controllerTabId;
		if (!tabId || tabId < 0) {
			this.debugLog('No valid tabId for Keychain broadcast', 'warn');
			return ServiceCallResult.ERROR_OTHER;
		}

		// videoKind ('movie' | 'episode') wins when the connector reports it —
		// long-form video has its own payload shape. Falls back to the music
		// disposition (podcast > video > song).
		const videoKind = song.parsed.videoKind ?? null;
		const kind: HiveScrobblePayload['kind'] = videoKind
			? videoKind
			: song.parsed.isPodcast
				? 'podcast'
				: song.parsed.isVideo
					? 'video'
					: 'song';
		const isLongForm = kind === 'movie' || kind === 'episode';

		const payload: HiveScrobblePayload & { now_playing?: boolean } = {
			app: APP_NAME,
			kind,
			title: song.getTrack() ?? '',
			timestamp: new Date(song.metadata.startTimestamp * 1000).toISOString(),
		};

		if (isLongForm) {
			// Video-side fields. The metadata pipeline stage (Wikipedia +
			// Wikidata) fills wikipediaUrl + imdbId + poster URL before
			// broadcast. Poster URL doubles as `trackArt` on song.parsed
			// (so the popup renders it inline) and as `poster_url` on the
			// broadcast payload (so feed cards on zingit-web can render
			// without extra fetches).
			if (song.parsed.wikipediaUrl) payload.wikipedia_url = song.parsed.wikipediaUrl;
			if (song.parsed.imdbId) payload.imdb_id = song.parsed.imdbId;
			if (song.parsed.year) payload.year = song.parsed.year;
			const poster = song.parsed.trackArt ?? song.metadata.trackArtUrl;
			if (poster) payload.poster_url = poster;
			if (kind === 'episode') {
				if (song.parsed.season) payload.season = song.parsed.season;
				if (song.parsed.episode) payload.episode_number = song.parsed.episode;
				if (song.parsed.seriesTitle) payload.series_title = song.parsed.seriesTitle;
				if (song.parsed.seriesWikipediaUrl) payload.series_wikipedia_url = song.parsed.seriesWikipediaUrl;
				if (song.parsed.seriesImdbId) payload.series_imdb_id = song.parsed.seriesImdbId;
			}
		} else {
			// Music-side fields.
			payload.artist = song.getArtist() ?? '';
			const album = song.getAlbum();
			if (album) {
				payload.album = album;
			}
			const duration = song.getDuration();
			if (duration) {
				const m = Math.floor(duration / 60);
				const s = Math.floor(duration % 60);
				payload.duration = `${m}:${s.toString().padStart(2, '0')}`;
			}
		}

		if (nowPlaying) {
			payload.now_playing = true;
		}

		if (percentPlayed !== undefined) {
			payload.percent_played = percentPlayed;
		}

		payload.platform = song.connector.label.toLowerCase();

		const url = song.parsed.originUrl;
		if (url) {
			payload.url = url;
		}

		const displayLeft = isLongForm
			? payload.series_title || payload.title
			: payload.artist;
		const displayRight = isLongForm
			? payload.series_title
				? `${payload.title}${payload.season && payload.episode_number ? ` (S${payload.season}E${payload.episode_number})` : ''}`
				: payload.title
			: payload.title;
		const displayMsg = nowPlaying
			? `Now playing: ${displayLeft ? `${displayLeft} - ` : ''}${displayRight}`
			: `Scrobble: ${displayLeft ? `${displayLeft} - ` : ''}${displayRight}`;

		try {
			await injectRelay(tabId);
			// Fire and forget — Keychain handles the signing asynchronously.
			// The service worker can be killed while waiting for user interaction,
			// so we don't await the response. The tx either lands or Keychain shows an error.
			void sendBackgroundMessage(tabId, {
				type: 'hiveBroadcast',
				payload: {
					username,
					id: CUSTOM_JSON_ID,
					json: JSON.stringify(payload),
					displayMsg,
				},
			}).catch(() => {/* channel closed before response — tx still broadcasts */});
			return ServiceCallResult.RESULT_OK;
		} catch {
			this.debugLog('Failed to broadcast custom_json via Keychain', 'error');
			return ServiceCallResult.ERROR_OTHER;
		}
	}
}
