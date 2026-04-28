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

export function setupZingitAuthSync(): void {
	if (!isAllowedHost()) return;

	// Initial announce — covers the case where the page loaded after the
	// extension was already connected.
	void getStoredUsername().then(announce);

	// Re-announce when our session changes (e.g. user connected from
	// the extension's options page in another tab).
	browser.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local' || !('Hive' in changes)) return;
		const next = changes.Hive.newValue as { sessionID?: string } | undefined;
		announce(next?.sessionID ?? null);
	});

	// Adopt usernames Zingit announces after a website-side connect.
	window.addEventListener('message', (event) => {
		if (event.source !== window) return;
		if (event.origin !== window.location.origin) return;
		const d = event.data as Partial<AuthSyncMessage> | undefined;
		if (!d || d.__auth_sync !== true || d.source !== 'website') return;
		// Login propagation only — see module header for rationale.
		if (typeof d.username !== 'string' || !d.username) return;
		void getStoredUsername().then((current) => {
			if (current === d.username) return;
			void setStoredUsername(d.username!);
		});
	});
}
