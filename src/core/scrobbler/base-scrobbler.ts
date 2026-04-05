'use strict';

import type { DebugLogType } from '@/util/util';
import { debugLog } from '@/util/util';
import type { BaseSong } from '@/core/object/song';
import type { ServiceCallResult } from '@/core/object/service-call-result';
import type { ScrobblerModels } from '@/core/storage/wrapper';
import type StorageWrapper from '@/core/storage/wrapper';
import type { StorageNamespace } from '../storage/browser-storage';
import { getScrobblerStorage } from '../storage/browser-storage';
import type ClonedSong from '../object/cloned-song';

export interface SessionData {
	/** ID of a current session */
	sessionID: string;
	/** A session name (username) */
	sessionName?: string;
	/** A token that can be traded for a session ID */
	token?: string;
}

export interface ScrobblerSongInfo {
	artist: string;
	artistUrl: string;

	track: string;
	trackUrl: string;
	trackArtUrl?: string;

	album?: string;
	albumUrl?: string;
	albumMbId?: string;

	userloved?: boolean;
	userPlayCount: number;

	duration: number | null;
}

/**
 * Base scrobbler object.
 *
 * Descendants of this object MUST return ServiceCallResult constants
 * as result or error value in functions that perform API calls.
 *
 * Each scrobbler has its storage which can contain session data and/or
 * other user data.
 *
 *
 * Base scrobbler does not define how and when to write in the storage;
 * it depends on module implementation or/and service features.
 *
 * Basic implementation relies on session data stored in the storage as it
 * described above.
 */
export default abstract class BaseScrobbler<K extends keyof ScrobblerModels> {
	protected storage: StorageWrapper<K>;
	abstract isLocalOnly: boolean;

	constructor() {
		this.storage = this.initStorage();
	}

	/** Authentication */

	/**
	 * Get auth URL where user should grant permission to the extension.
	 * Implementation must return an auth URL.
	 */
	public abstract getAuthUrl(): Promise<string>;

	/**
	 * Get session data.
	 * Implementation must return a session data.
	 */
	public abstract getSession(): Promise<SessionData>;

	/**
	 * Remove session info.
	 */
	public async signOut(): Promise<void> {
		const data = await this.storage.get();
		if (!data) {
			debugLog('No data in storage', 'error');
			return;
		}

		if ('sessionID' in data) {
			delete data.sessionID;
		}
		if ('sessionName' in data) {
			delete data.sessionName;
		}
		if ('arrayProperties' in data) {
			delete data.arrayProperties;
		}

		await this.storage.set(data);
	}

	/**
	 * Check if the scrobbler is waiting until user grant access to
	 * scrobbler service.
	 * Implementation must return a check result as a boolean value.
	 */
	public abstract isReadyForGrantAccess(): Promise<boolean>;

	/** API requests */

	/**
	 * Send current song as 'now playing' to API.
	 * Implementation must return ServiceCallResult constant.
	 *
	 * @param song - Song instance
	 */

	public abstract sendNowPlaying(song: BaseSong): Promise<ServiceCallResult>;

	/**
	 * Send resumed playing status of song to API.
	 * Implementation must return ServiceCallResult constant.
	 *
	 * @param song - Song instance
	 */

	public abstract sendResumedPlaying(
		song: BaseSong,
	): Promise<ServiceCallResult>;

	/**
	 * Send paused status of song to API.
	 * Implementation must return ServiceCallResult constant.
	 *
	 * @param song - Song instance
	 */

	public abstract sendPaused(song: BaseSong): Promise<ServiceCallResult>;

	/**
	 * Send songs to API to scrobble.
	 * Implementation must return ServiceCallResult constant.
	 *
	 * @param song - Song instances
	 */

	public abstract scrobble(
		song: BaseSong[],
		currentlyPlaying: boolean,
	): Promise<ServiceCallResult[]>;

	/**
	 * Love or unlove given song.
	 * Implementation must return ServiceCallResult constant.
	 *
	 * @param song - Song instance
	 * @param isLoved - Flag means song should be loved or not
	 */

	public abstract toggleLove(
		song: ClonedSong,
		isLoved: boolean,
	): Promise<ServiceCallResult | Record<string, never>>;

	/**
	 * Get song info.
	 * Implementation must return object contains a song data.
	 *
	 * @param song - Song instance
	 */

	public abstract getSongInfo(
		song: BaseSong,
	): Promise<ScrobblerSongInfo | Record<string, never>>;

	/* Getters. */

	/**
	 * Get status page URL.
	 */
	public abstract getStatusUrl(): string;

	/**
	 * Get the scrobbler label.
	 */
	public abstract getLabel(): 'Hive';

	/**
	 * Get URL to profile page.
	 * @returns Profile URL
	 */
	public async getProfileUrl(): Promise<string> {
		const { sessionName } = await this.getSession();
		return `${this.getBaseProfileUrl()}${sessionName ?? 'undefined'}`;
	}

	/**
	 * Get a storage namespace where the scrobbler data will be stored.
	 */
	protected abstract getStorageName(): StorageNamespace;

	/**
	 * Get base profile URL.
	 */
	protected abstract getBaseProfileUrl(): string;

	/** Scrobbler features. */

	/**
	 * Check if service supports loving songs.
	 * @returns True if service supports that; false otherwise
	 */
	public canLoveSong(): boolean {
		return false;
	}

	/**
	 * Check if service supports retrieving of song info.
	 * @returns True if service supports that; false otherwise
	 */
	public canLoadSongInfo(): boolean {
		return false;
	}

	/**
	 * Apply filters over song object. Override if scrobbler requires custom global filtering.
	 *
	 * @param song - the song about to be dispatched
	 * @returns updated song
	 */
	public applyFilter(song: BaseSong): BaseSong {
		return song;
	}

	/** Constants */

	/**
	 * Get timeout of all API requests in milliseconds.
	 */
	protected get REQUEST_TIMEOUT(): number {
		return 15_000;
	}

	/** Misc */

	/**
	 * Helper function to show debug output.
	 * @param text - Debug message
	 * @param logType - Log type
	 */
	protected debugLog(text: string, logType: DebugLogType = 'log'): void {
		const message = `${this.getLabel()}: ${text}`;
		debugLog(message, logType);
	}

	/** Internal functions */

	private initStorage() {
		const storage = getScrobblerStorage<K>(this.getStorageName());
		void storage.debugLog(['sessionID', 'sessionName']);
		return storage;
	}
}
