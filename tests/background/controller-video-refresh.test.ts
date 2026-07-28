import { describe, expect, it, vi } from 'vitest';
import Song from '@/core/object/song';
import type { State } from '@/core/types';

vi.mock('webextension-polyfill', () => import('#/mocks/webextension-polyfill'));

/**
 * The music-vs-video disposition arrives LATE.
 *
 * Connector.isVideo() on YouTube reads the player title and channel out of the
 * DOM and consults YouTube Music's recognition lookup. None of that is
 * guaranteed to be there when the Song is constructed — and that construction
 * used to be the only time the value was read. A trailer whose title element
 * hadn't painted yet went to an immutable chain as `song`, even though the
 * connector reported the correction a moment later.
 *
 * Controller.processCurrentState now copies the disposition on every state
 * change. These tests pin the two halves of that contract: the value must be
 * updatable after construction, and it must survive into the cloneable data
 * the Hive scrobbler reads when it builds the payload.
 */

const baseState = (over: Partial<State> = {}): State =>
	({
		artist: 'A24',
		track: 'Bring Her Back | Official Trailer HD',
		album: null,
		albumArtist: null,
		currentTime: 5,
		duration: 150,
		isPlaying: true,
		isPodcast: false,
		// The race: the title element hadn't painted, so the connector's
		// patterns had nothing to match and reported "not a video".
		isVideo: false,
		originUrl: 'https://youtu.be/kBskrYZfhw8',
		trackArt: null,
		uniqueID: 'kBskrYZfhw8',
		...over,
	}) as State;

const meta = { id: 'youtube', label: 'YouTube', matches: [] };

describe('late video-disposition corrections', () => {
	it('starts with whatever the connector knew at construction', () => {
		const song = new Song(baseState(), meta);
		expect(song.parsed.isVideo).toBe(false);
	});

	it('accepts a correction once the DOM has painted', () => {
		const song = new Song(baseState(), meta);
		// What Controller.processCurrentState now does on each state change.
		song.parsed.isVideo = true;
		expect(song.parsed.isVideo).toBe(true);
	});

	it('carries the correction into the payload the scrobbler reads', () => {
		const song = new Song(baseState(), meta);
		song.parsed.isVideo = true;
		// getCloneableData() is what scrobbleSong() serialises at submit time;
		// if the correction stopped here, the chain would still say `song`.
		expect(song.getCloneableData().parsed.isVideo).toBe(true);
	});

	it('keeps a podcast disposition distinct from video', () => {
		const song = new Song(baseState({ isPodcast: true }), meta);
		expect(song.parsed.isPodcast).toBe(true);
		song.parsed.isVideo = true;
		expect(song.getCloneableData().parsed.isPodcast).toBe(true);
		expect(song.getCloneableData().parsed.isVideo).toBe(true);
	});
});
