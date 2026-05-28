import { describe, it, expect, beforeAll } from 'vitest';
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import {
	recoverPostingPubkey,
	decodeHivePubkey,
	base58Decode,
} from '@/core/scrobbler/hive/posting-key-verify';

// noble v3 needs hash hooks for sign(). recoverPostingPubkey itself doesn't
// (it pre-hashes with Web Crypto), but the test signs to build a vector.
beforeAll(() => {
	secp.hashes.sha256 = sha256;
	secp.hashes.hmacSha256 = (key: Uint8Array, msg: Uint8Array) =>
		hmac(sha256, key, msg);
});

function toHex(b: Uint8Array): string {
	return Array.from(b)
		.map((x) => x.toString(16).padStart(2, '0'))
		.join('');
}

function bigIntTo32(value: bigint): Uint8Array {
	let n = value;
	const out = new Uint8Array(32);
	for (let i = 31; i >= 0; i--) {
		out[i] = Number(n & 0xffn);
		n >>= 8n;
	}
	return out;
}

/** Re-encode a noble signature over `challenge` into Hive's compact format:
 *  [31 + recoveryId, r(32), s(32)] hex. */
function hiveSigFor(challenge: string, sk: Uint8Array): string {
	const nobleSig = secp.sign(new TextEncoder().encode(challenge), sk, {
		format: 'recovered',
	});
	const sig = secp.Signature.fromBytes(nobleSig, 'recovered');
	const hive = new Uint8Array(65);
	hive[0] = (sig.recovery ?? 0) + 31;
	hive.set(bigIntTo32(sig.r), 1);
	hive.set(bigIntTo32(sig.s), 33);
	return toHex(hive);
}

const CHALLENGE = 'zingit:privacy-key:v1';

describe('recoverPostingPubkey', () => {
	it('recovers the exact signing key from a Hive-format signature', async () => {
		const sk = secp.utils.randomSecretKey();
		const pub = secp.getPublicKey(sk, true); // 33-byte compressed
		const recovered = await recoverPostingPubkey(
			CHALLENGE,
			hiveSigFor(CHALLENGE, sk),
		);
		expect(recovered).not.toBeNull();
		expect(toHex(recovered!)).toBe(toHex(pub));
	});

	it('does not recover the signing key from a tampered signature', async () => {
		const sk = secp.utils.randomSecretKey();
		const pub = secp.getPublicKey(sk, true);
		const hex = hiveSigFor(CHALLENGE, sk);
		// Flip a byte inside r.
		const bytes = hex.split('');
		bytes[10] = bytes[10] === '0' ? '1' : '0';
		const recovered = await recoverPostingPubkey(CHALLENGE, bytes.join(''));
		// Either unrecoverable (null) or a different key — never the real one.
		if (recovered) {
			expect(toHex(recovered)).not.toBe(toHex(pub));
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
