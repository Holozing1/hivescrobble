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

	/** Cross-restart persistence: read finalized keys from session storage. */
	private async getFinalizedKeys(): Promise<Set<number>> {
		const data = await browser.storage.session.get('finalizedKeys')
		return new Set<number>(data.finalizedKeys ?? [])
	}

	private async addFinalizedKey(key: number): Promise<void> {
		const keys = await this.getFinalizedKeys()
		keys.add(key)
		await browser.storage.session.set({ finalizedKeys: [...keys] })
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
	 * Called when a scrobbled song finishes playing (via hiveFinalize message).
	 * Broadcasts the scrobble with accurate play percentage and 160% double-listen detection.
	 */
	public async finalize(playSeconds: number, song: ClonedSong): Promise<void> {
		const key = song.metadata.startTimestamp;

		// Synchronous in-memory claim — prevents race within the same SW lifecycle.
		if (HiveScrobbler.lockedKeys.has(key)) return;
		HiveScrobbler.lockedKeys.add(key);

		// Cross-restart persistence check — catches re-triggers after SW killed/restarted.
		const finalizedKeys = await this.getFinalizedKeys()
		if (finalizedKeys.has(key)) return;
		await this.addFinalizedKey(key);

		const duration = song.getDuration() ?? 0;
		// 1 tx at ≥60%, then 1 more for each additional 100% of duration (160%, 260%, …).
		// Cap at 3 to guard against accumulated time bugs causing runaway broadcasts.
		const txCount = Math.min(3, duration > 0 ? 1 + Math.floor(Math.max(0, (playSeconds / duration) - 0.6)) : 1);

		for (let i = 0; i < txCount; i++) {
			// Each tx reflects how far into its own 100% cycle the listener got.
			const percentPlayed = duration > 0
				? Math.min(100, Math.round(((playSeconds / duration) - i) * 100))
				: 0;
			void this.broadcastScrobble(song, false, percentPlayed);
		}
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
							!d?.__hobbles ||
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
						{ __hobbles: true, type: 'hiveConnect', id },
						'*',
					);
				}),
		});

		const username = results?.[0]?.result;
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

		const payload: HiveScrobblePayload & { now_playing?: boolean } = {
			app: APP_NAME,
			artist: song.getArtist() ?? '',
			title: song.getTrack() ?? '',
		};

		const album = song.getAlbum();
		if (album) {
			payload.album = album;
		}

		payload.timestamp = new Date(song.metadata.startTimestamp * 1000).toISOString();

		if (nowPlaying) {
			payload.now_playing = true;
		}

		const duration = song.getDuration();
		if (duration) {
			const m = Math.floor(duration / 60);
			const s = Math.floor(duration % 60);
			payload.duration = `${m}:${s.toString().padStart(2, '0')}`;
		}

		if (percentPlayed !== undefined) {
			payload.percent_played = percentPlayed;
		}

		payload.platform = song.connector.label.toLowerCase();

		const url = song.parsed.originUrl;
		if (url) {
			payload.url = url;
		}

		const displayMsg = nowPlaying
			? `Now playing: ${payload.artist} - ${payload.title}`
			: `Scrobble: ${payload.artist} - ${payload.title}`;

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
