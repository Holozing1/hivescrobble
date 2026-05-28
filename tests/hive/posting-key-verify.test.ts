import { describe, it, expect } from 'vitest';
import {
	recoverPostingPubkey,
	decodeHivePubkey,
	base58Decode,
} from '@/core/scrobbler/hive/posting-key-verify';

// Static vector — a real secp256k1 signature over the challenge in Hive's
// graphene compact format (header = recoveryId + 31, then r||s, signed over
// sha256(challenge)), plus the compressed public key that produced it.
// Generated once with @noble/secp256k1 (a fixed test key) so the test needs
// no signing deps and is fully deterministic.
const CHALLENGE = 'zingit:privacy-key:v1';
const SIG_HEX =
	'1f9859d6c39fac5f6ff755afd3ee36d764928fa10bf1b53840dfc8d44e802b2f' +
	'961443acc2c3e8c2a8e6dd7742aa2bfb6e04d9abdc143575d4bf436e0aebb12f13';
const PUBKEY_HEX =
	'03f324133f92f203537cd7f9c4f1cf1078020159111a18457809ce3c11950d87eb';

const toHex = (b: Uint8Array): string =>
	Array.from(b)
		.map((x) => x.toString(16).padStart(2, '0'))
		.join('');

describe('recoverPostingPubkey', () => {
	it('recovers the exact signing key from a Hive-format signature', async () => {
		const recovered = await recoverPostingPubkey(CHALLENGE, SIG_HEX);
		expect(recovered).not.toBeNull();
		expect(toHex(recovered!)).toBe(PUBKEY_HEX);
	});

	it('does not recover the same key from a tampered signature', async () => {
		const flipped = SIG_HEX[10] === '0' ? '1' : '0';
		const bad = SIG_HEX.slice(0, 10) + flipped + SIG_HEX.slice(11);
		const recovered = await recoverPostingPubkey(CHALLENGE, bad);
		if (recovered) {
			expect(toHex(recovered)).not.toBe(PUBKEY_HEX);
		}
	});

	it('does not recover the same key for a different challenge', async () => {
		const recovered = await recoverPostingPubkey(
			'a-different-string',
			SIG_HEX,
		);
		if (recovered) {
			expect(toHex(recovered)).not.toBe(PUBKEY_HEX);
		}
	});

	it('rejects malformed signatures', async () => {
		expect(await recoverPostingPubkey(CHALLENGE, 'not-hex')).toBeNull();
		expect(await recoverPostingPubkey(CHALLENGE, 'ab')).toBeNull();
	});
});

describe('decodeHivePubkey', () => {
	it('decodes the STM null key to 33 zero bytes', () => {
		const key = decodeHivePubkey(
			'STM1111111111111111111111111111111114T1Anm',
		);
		expect(key).not.toBeNull();
		expect(key!.length).toBe(33);
		expect(Array.from(key!).every((b) => b === 0)).toBe(true);
	});

	it('base58Decode rejects invalid characters', () => {
		expect(() => base58Decode('0OIl')).toThrow();
	});
});
