'use strict';

/**
 * Verify that a Keychain `requestSignBuffer` signature over our challenge was
 * really produced by the account's posting key — by recovering the public key
 * from the signature and comparing it to the account's on-chain posting key(s).
 *
 * This is the defence-in-depth half of the privacy-key fix: even if something
 * on the (trusted) signing origin hands back a forged or junk signature, a key
 * derived from it won't match the chain, so we refuse to use it.
 *
 * Format notes (graphene / Hive):
 *   - requestSignBuffer signs sha256(message) with the posting key.
 *   - the returned signature is a 65-byte compact recoverable sig, hex-encoded:
 *       byte[0]      = 31 + recoveryId   (the +31 = 27 + 4, compressed-key flag)
 *       byte[1..33]  = r (big-endian)
 *       byte[33..65] = s (big-endian)
 *   - posting public keys are "STM" + base58(33-byte compressed key + 4-byte
 *     ripemd160 checksum). We only need the leading 33 key bytes to compare.
 */

import * as secp from '@noble/secp256k1';

const HIVE_NODES = [
	'https://api.openhive.network',
	'https://hive-api.arcange.eu',
	'https://api.hive.blog',
];

const B58_ALPHABET =
	'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function hexToBytes(hex: string): Uint8Array | null {
	if (hex.length % 2 !== 0) {
		return null;
	}
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		const byte = parseInt(hex.substr(i * 2, 2), 16);
		if (Number.isNaN(byte)) {
			return null;
		}
		out[i] = byte;
	}
	return out;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
	let n = 0n;
	for (const b of bytes) {
		n = (n << 8n) | BigInt(b);
	}
	return n;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a[i] ^ b[i];
	}
	return diff === 0;
}

/** Decode a base58 string to bytes (Bitcoin alphabet). Throws on bad chars. */
export function base58Decode(str: string): Uint8Array {
	let num = 0n;
	for (const ch of str) {
		const idx = B58_ALPHABET.indexOf(ch);
		if (idx < 0) {
			throw new Error('invalid base58 character');
		}
		num = num * 58n + BigInt(idx);
	}
	const bytes: number[] = [];
	while (num > 0n) {
		bytes.unshift(Number(num & 0xffn));
		num >>= 8n;
	}
	// Leading '1's in base58 represent leading zero bytes.
	for (let i = 0; i < str.length && str[i] === '1'; i++) {
		bytes.unshift(0);
	}
	return new Uint8Array(bytes);
}

/** Pull the 33-byte compressed key out of an "STM…" public key string. */
export function decodeHivePubkey(key: string): Uint8Array | null {
	if (typeof key !== 'string' || key.length < 4) {
		return null;
	}
	// Hive kept graphene's legacy "STM" prefix.
	const body = key.startsWith('STM') ? key.slice(3) : key;
	let raw: Uint8Array;
	try {
		raw = base58Decode(body);
	} catch {
		return null;
	}
	if (raw.length < 33) {
		return null;
	}
	return raw.slice(0, 33);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return new Uint8Array(digest);
}

/** Fetch the account's posting public key strings from a Hive node. */
async function fetchPostingPubkeys(username: string): Promise<string[]> {
	const body = JSON.stringify({
		jsonrpc: '2.0',
		method: 'condenser_api.get_accounts',
		params: [[username]],
		id: 1,
	});
	for (const node of HIVE_NODES) {
		try {
			const res = await fetch(node, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
				signal: AbortSignal.timeout(8000),
			});
			if (!res.ok) {
				continue;
			}
			const data = await res.json();
			const auths = data?.result?.[0]?.posting?.key_auths;
			if (Array.isArray(auths)) {
				return auths
					.map((a: unknown) => (Array.isArray(a) ? a[0] : null))
					.filter((k: unknown): k is string => typeof k === 'string');
			}
		} catch {
			// try next node
		}
	}
	return [];
}

/**
 * Recover the compressed public key that produced `sigHex` over
 * sha256(challenge), or null if the signature can't be parsed/recovered.
 */
export async function recoverPostingPubkey(
	challenge: string,
	sigHex: string,
): Promise<Uint8Array | null> {
	const sig = hexToBytes(sigHex);
	if (!sig || sig.length !== 65) {
		return null;
	}
	const recovery = sig[0] - 31;
	if (recovery < 0 || recovery > 3) {
		return null;
	}
	const r = bytesToBigInt(sig.subarray(1, 33));
	const s = bytesToBigInt(sig.subarray(33, 65));
	try {
		const recoveredFmt = new secp.Signature(r, s, recovery).toBytes(
			'recovered',
		);
		const hash = await sha256(new TextEncoder().encode(challenge));
		const recovered = secp.recoverPublicKey(recoveredFmt, hash, {
			prehash: false,
		});
		// Normalise to compressed form so the comparison is layout-independent.
		return secp.Point.fromBytes(recovered).toBytes(true);
	} catch {
		return null;
	}
}

/**
 * True iff `sigHex` is a genuine posting-key signature over `challenge` for
 * `username`. Fails closed: any parse/recovery/network problem returns false.
 */
export async function verifyChallengeSignature(
	username: string,
	challenge: string,
	sigHex: string,
): Promise<boolean> {
	const recovered = await recoverPostingPubkey(challenge, sigHex);
	if (!recovered) {
		return false;
	}
	const chainKeys = await fetchPostingPubkeys(username);
	if (chainKeys.length === 0) {
		return false;
	}
	for (const key of chainKeys) {
		const decoded = decodeHivePubkey(key);
		if (decoded && bytesEqual(decoded, recovered)) {
			return true;
		}
	}
	return false;
}
