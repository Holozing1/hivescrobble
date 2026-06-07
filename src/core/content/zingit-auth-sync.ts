/**
 * Cross-app auth sync between Hive Scrobbler (this extension) and the
 * scrobble.life website.
 *
 * Both surfaces verify identity via Hive Keychain independently, but they
 * each persist the verified username separately (extension storage vs. web
 * cookie+localStorage), so logging in on one side leaves the other showing
 * a Connect button. This module bridges them on pages where Zingit lives:
 *
 *   - On script load: read this extension's current session and announce
 *     it to the page so the website's HiveAuthProvider can adopt it
 *     without re-prompting.
 *   - On extension storage changes (e.g. user connects via the options
 *     page): re-announce so an open scrobble.life tab updates live.
 *   - On Zingit announcements (after the user connects on the website): if
 *     the username differs from ours, write it into extension storage so
 *     subsequent scrobbles use the same account.
 *
 * Design notes:
 *   - Login propagates both ways. Logout does NOT — clearing one side
 *     should not silently nuke the other (the user may still want
 *     extension-side scrobbling after logging out of the website).
 *   - Trust is anchored to Keychain: we only announce a username AFTER
 *     the originating surface verified it via requestSignBuffer. Sharing
 *     a verified identity grants no new authority — every signed op
 *     re-prompts Keychain regardless.
 *   - Gated by hostname so we don't broadcast the user's Hive handle to
 *     unrelated sites (every music page that loads the connector script
 *     would otherwise see it).
 */

import browser from 'webextension-polyfill';

const ALLOWED_HOSTS = new Set([
	'scrobble.life',
	'www.scrobble.life',
	'localhost',
	'127.0.0.1',
]);

interface AuthSyncMessage {
	__auth_sync: true;
	source: 'extension' | 'website';
	username: string | null;
}

function isAllowedHost(): boolean {
	try {
		return ALLOWED_HOSTS.has(window.location.hostname);
	} catch {
		return false;
	}
}

async function getStoredUsername(): Promise<string | null> {
	try {
		const data = await browser.storage.local.get('Hive');
		const hive = (data?.Hive ?? {}) as { sessionID?: string };
		return hive.sessionID ?? null;
	} catch {
		return null;
	}
}

async function setStoredUsername(username: string): Promise<void> {
	try {
		await browser.storage.local.set({
			Hive: { sessionID: username, sessionName: username },
		});
	} catch {
		// Storage write failure is non-fatal — next scrobble will try again
		// or the user can reconnect via the options page.
	}
}

function announce(username: string | null): void {
	const msg: AuthSyncMessage = {
		__auth_sync: true,
		source: 'extension',
		username,
	};
	try {
		window.postMessage(msg, window.location.origin);
	} catch {
		// postMessage shouldn't fail same-origin, but swallow defensively.
	}
}

/**
 * Drop a presence marker the Zingit website can read to detect that the
 * extension is installed (and which version). Set both as a `data-` attr
 * on `<html>` (synchronous read by the page) AND a CustomEvent (catches
 * the case where the page mounted before this content script ran). The
 * page reads version-string-or-null and shows a CTA accordingly.
 *
 * Read on the page side via:
 *   document.documentElement.dataset.hobblesInstalled
 *   document.addEventListener('hobbles:present', (e) => e.detail.version)
 */
function announcePresence(): void {
	let version = '';
	try {
		version = browser.runtime.getManifest().version ?? '';
	} catch {
		// Manifest unreachable in some odd contexts — leave version blank.
	}
	try {
		document.documentElement.setAttribute(
			'data-hobbles-installed',
			version || '1',
		);
		document.dispatchEvent(
			new CustomEvent('hobbles:present', { detail: { version } }),
		);
	} catch {
		// DOM not ready or sandboxed — non-fatal.
	}
}

/**
 * Trade the HttpOnly guest (Google) session cookie for a Bearer ingest
 * token the scrobbler can POST with. Runs same-origin on scrobble.life so
 * the cookie rides along. Stores { token, username, origin } under
 * `GuestAuth`; clears it when the visitor isn't a guest (401) or has
 * graduated to a Hive account (409). Hive (Keychain) users simply never
 * have a guest cookie, so this no-ops for them.
 */
async function syncGuestToken(): Promise<void> {
	try {
		const res = await fetch('/api/auth/extension-token', {
			credentials: 'include',
		});
		if (res.status === 200) {
			const d = (await res.json()) as {
				token?: string;
				username?: string | null;
			};
			if (d && typeof d.token === 'string' && d.token) {
				// Normalise www → apex so the scrobbler POSTs to the
				// canonical origin (a www→non-www 301 would break a POST).
				const origin = window.location.origin.replace('://www.', '://');
				await browser.storage.local.set({
					GuestAuth: {
						token: d.token,
						username: d.username ?? null,
						origin,
					},
				});
				return;
			}
		}
		if (res.status === 401 || res.status === 409) {
			await browser.storage.local.remove('GuestAuth');
		}
	} catch {
		// Offline / network error — keep any existing token.
	}
}

export function setupZingitAuthSync(): void {
	if (!isAllowedHost()) {
		return;
	}

	// Presence marker — runs first so the website can detect us even
	// before any auth sync has happened.
	announcePresence();

	// Pick up a guest (Google) ingest token if the user is signed in here.
	void syncGuestToken();

	// Initial announce — covers the case where the page loaded after the
	// extension was already connected.
	void getStoredUsername().then(announce);

	// Re-announce when our session changes (e.g. user connected from
	// the extension's options page in another tab).
	browser.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local' || !('Hive' in changes)) {
			return;
		}
		const next = changes.Hive.newValue as
			| { sessionID?: string }
			| undefined;
		announce(next?.sessionID ?? null);
	});

	// Adopt usernames Zingit announces after a website-side connect.
	window.addEventListener('message', (event) => {
		if (event.source !== window) {
			return;
		}
		if (event.origin !== window.location.origin) {
			return;
		}
		const d = event.data as Partial<AuthSyncMessage> | undefined;
		if (!d || d.__auth_sync !== true || d.source !== 'website') {
			return;
		}
		// Login propagation only — see module header for rationale.
		if (typeof d.username !== 'string' || !d.username) {
			return;
		}
		void getStoredUsername().then((current) => {
			if (current === d.username) {
				return;
			}
			void setStoredUsername(d.username!);
		});
	});
}
