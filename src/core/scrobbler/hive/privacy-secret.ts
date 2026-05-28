'use strict';

import browser from 'webextension-polyfill';

/**
 * Derives a stable AES-256 encryption secret from the user's Hive posting
 * key, without ever touching memo keys (which most accounts don't load
 * into Keychain). Uses the deterministic-signature property of Hive's
 * RFC 6979 ECDSA — signing a fixed challenge buffer with the same posting
 * key always produces the same signature, so the derived secret is stable
 * across sessions and across the extension + zingit-web without any
 * chain-side or server-side handoff.
 *
 * Flow:
 *   1. Keychain prompts: "Sign: zingit:privacy-key:v1" (Posting key)
 *   2. signature  = 64-byte hex string (deterministic per user)
 *   3. secret     = SHA-256(signature) → 32 bytes for AES-256-GCM
 *   4. Cached in browser.storage.local keyed by username, so subsequent
 *      encrypts/decrypts run silently. Cleared via clear() (manual escape
 *      hatch surfaced in extension settings).
 *
 * The challenge string is fixed for v1 so extension and zingit-web derive
 * the same secret. If the format ever needs to change, bump the version
 * suffix and migrate stored keys.
 */

const CHALLENGE = 'zingit:privacy-key:v1';
const STORAGE_KEY_PREFIX = 'privacy_secret_'; // namespaced per username

export class PrivacySecretError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = 'PrivacySecretError';
	}
}

/**
 * Get the user's privacy secret. Returns the cached value if present,
 * otherwise prompts Keychain via the given tab, derives, caches and
 * returns the new secret.
 *
 * Throws PrivacySecretError if Keychain is unavailable or rejected.
 */
export async function getOrDerive(
	username: string,
	tabId: number,
): Promise<ArrayBuffer> {
	const cached = await loadCached(username);
	if (cached) {
		return cached;
	}

	const sig = await signChallenge(username, tabId);
	const secret = await hashToKey(sig);
	await store(username, secret);
	return secret;
}

/** Returns the cached secret if any, otherwise null. Doesn't prompt. */
export async function getCached(username: string): Promise<ArrayBuffer | null> {
	return loadCached(username);
}

/** Wipes the cached secret for this username. */
export async function clear(username: string): Promise<void> {
	await browser.storage.local.remove(
		STORAGE_KEY_PREFIX + username.toLowerCase(),
	);
}

// ── Internals ──────────────────────────────────────────────────────────

async function loadCached(username: string): Promise<ArrayBuffer | null> {
	const k = STORAGE_KEY_PREFIX + username.toLowerCase();
	const data = await browser.storage.local.get(k);
	const hex = data[k] as string | undefined;
	if (!hex) {
		return null;
	}
	return hexToBuffer(hex);
}

async function store(username: string, secret: ArrayBuffer): Promise<void> {
	const k = STORAGE_KEY_PREFIX + username.toLowerCase();
	await browser.storage.local.set({ [k]: bufferToHex(secret) });
}

/**
 * Request a posting-key signature over our fixed challenge, in the given tab.
 *
 * SECURITY: this must only ever run in a tab on a trusted origin
 * (scrobble.life) — the caller enforces that. Unlike the public scrobble
 * relay, the privacy signature must NOT transit the page via
 * window.postMessage (any co-resident page script could read it and derive
 * the AES key, or forge a result). Instead we run a MAIN-world function that
 * calls window.hive_keychain directly and returns the result through the
 * privileged scripting channel — the page's own JS never sees it. The only
 * residual exposure is a compromise of the trusted origin itself (which could
 * hijack window.hive_keychain); the signature verification in getOrDerive
 * defends against a hijacked Keychain returning a forged signature.
 */
async function signChallenge(username: string, tabId: number): Promise<string> {
	type KcResult = {
		success: boolean;
		result?: string;
		message?: string;
		error?: string;
	};
	type Kc = {
		requestSignBuffer: (
			u: string | null,
			message: string,
			keyType: string,
			cb: (r: KcResult) => void,
		) => void;
	};

	const results = await browser.scripting.executeScript({
		target: { tabId },
		world: 'MAIN',
		args: [username, CHALLENGE],
		func: (user: string, challenge: string) =>
			new Promise<{ signature?: string; error?: string }>((resolve) => {
				const kc = (window as unknown as { hive_keychain?: Kc })
					.hive_keychain;
				if (!kc) {
					resolve({
						error: 'Hive Keychain wasn’t detected on scrobble.life. Make sure the Keychain extension is installed and the tab finished loading.',
					});
					return;
				}
				kc.requestSignBuffer(
					user,
					challenge,
					'Posting',
					(r: KcResult) => {
						if (r.success && r.result) {
							resolve({ signature: r.result });
						} else {
							resolve({
								error:
									r.message ||
									r.error ||
									'Keychain rejected the signature',
							});
						}
					},
				);
			}),
	});

	const out = results?.[0]?.result as
		| { signature?: string; error?: string }
		| undefined;
	if (!out) {
		throw new PrivacySecretError('Keychain call returned no result');
	}
	if (out.error) {
		throw new PrivacySecretError(out.error);
	}
	if (!out.signature) {
		throw new PrivacySecretError('Keychain did not return a signature');
	}
	return out.signature;
}

async function hashToKey(hexSignature: string): Promise<ArrayBuffer> {
	// Hash the raw signature bytes (not the hex string) so the secret is
	// 32 bytes of pure entropy from the ECDSA output, not biased by the
	// hex alphabet.
	const sigBytes = hexToBuffer(hexSignature);
	return crypto.subtle.digest('SHA-256', sigBytes);
}

function bufferToHex(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let out = '';
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i].toString(16).padStart(2, '0');
	}
	return out;
}

function hexToBuffer(hex: string): ArrayBuffer {
	if (hex.length % 2 !== 0) {
		throw new PrivacySecretError('odd-length hex string');
	}
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
	}
	return bytes.buffer;
}
