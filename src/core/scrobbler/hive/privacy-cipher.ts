'use strict';

/**
 * AES-256-GCM helpers for encrypting/decrypting scrobble payloads with the
 * privacy secret derived from the user's Hive posting key (see
 * privacy-secret.ts). Uses Web Crypto, which is available in both the
 * extension (MV3 service worker / ISOLATED content world) and in browser
 * contexts on zingit-web — no external dependency.
 *
 * Format on the wire: base64( IV (12 bytes) ‖ ciphertext+authTag (N bytes) )
 *
 * IV is freshly randomized per call so the same payload encrypts to
 * different blobs every time — important because Hive blocks are public,
 * and a deterministic ciphertext would let an observer recognize replays
 * of the same song without ever decrypting.
 *
 * Both the extension and zingit-web should import this exact same module
 * (or a verbatim copy) so the formats stay in sync. If we ever change
 * the wire format, the `v` field on the chain payload bumps and we keep
 * a versioned decrypt path for older blobs.
 */

const IV_BYTES = 12;   // GCM standard

export async function encrypt(payload: object, secret: ArrayBuffer): Promise<string> {
	const iv  = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const key = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt']);
	const data = new TextEncoder().encode(JSON.stringify(payload));
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
	const out = new Uint8Array(IV_BYTES + cipher.byteLength);
	out.set(iv, 0);
	out.set(new Uint8Array(cipher), IV_BYTES);
	return bufferToBase64(out);
}

export async function decrypt(blob: string, secret: ArrayBuffer): Promise<unknown> {
	const all = base64ToBuffer(blob);
	if (all.byteLength < IV_BYTES + 16) {
		throw new Error('blob too short for IV + GCM auth tag');
	}
	const iv     = all.slice(0, IV_BYTES);
	const cipher = all.slice(IV_BYTES);
	const key    = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['decrypt']);
	let plain: ArrayBuffer;
	try {
		plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
	} catch {
		// AES-GCM auth-tag mismatch — wrong key, tampered ciphertext, or
		// blob from a different format version. Throw a uniform error so
		// callers can surface "couldn't decrypt this scrobble" without
		// leaking which failure mode it was.
		throw new Error('decryption failed');
	}
	const text = new TextDecoder().decode(plain);
	return JSON.parse(text);
}

// ── base64 helpers (no Buffer; works in browser + service worker) ──────

function bufferToBase64(buf: Uint8Array): string {
	let s = '';
	for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
	return btoa(s);
}

function base64ToBuffer(b64: string): ArrayBuffer {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out.buffer;
}
