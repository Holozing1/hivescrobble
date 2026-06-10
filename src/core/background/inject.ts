import browser from 'webextension-polyfill';

/**
 * Attempts to inject the connector into the page.
 *
 * Function does not wait for injection to finish, because it can hang if the tab is asleep.
 *
 * @param tab - The tab to inject the connector into
 * @returns A promise that resolves when the connector is being injected.
 */
async function attemptInjectTab(tab: browser.Tabs.Tab) {
	if (typeof tab.id === 'undefined') {
		throw new Error(`Could not identify tab: ${JSON.stringify(tab)}`);
	}

	let url = tab.url;
	if (typeof url === 'undefined') {
		url = await browser.tabs.get(tab.id).then((idTab) => idTab.url);
	}
	if (typeof url === 'undefined') {
		throw new Error(
			`Could not identify URL of tab: ${JSON.stringify(tab)}`,
		);
	}

	return injectConnector(tab.id, url);
}

/**
 * URL schemes Chrome refuses to inject into regardless of how broad
 * host_permissions are. Trying anyway throws "Cannot access contents
 * of the page. Extension manifest must request permission..." which
 * surfaces in chrome://extensions as a scary user-visible error.
 *
 * Pre-filter here so we never attempt the call on these — keeps the
 * extension's error list clean.
 */
const RESTRICTED_URL_SCHEMES = [
	'chrome://',
	'chrome-extension://',
	'chrome-search://',
	'edge://',
	'extension://',
	'brave://',
	'opera://',
	'vivaldi://',
	'about:',
	'view-source:',
	'file://',
	'javascript:',
	'data:',
	'chrome.google.com/webstore',
	'chromewebstore.google.com',
];

function isRestrictedUrl(url: string): boolean {
	return RESTRICTED_URL_SCHEMES.some(
		(s) => url.startsWith(s) || url.includes(s),
	);
}

/**
 * Does the actual injection attempt after checking for missing properties.
 *
 * @param tabId - The tab to inject the connector into
 * @param url - The URL of the tab
 * @returns A promise that resolves when the connector is injected
 */
async function injectConnector(tabId: number, url: string) {
	// Cheap early exit on URLs Chrome won't let us touch (chrome://,
	// chrome-extension://, web store, etc.). Without this filter,
	// reload-time injection fans out into every open tab and the
	// rejections from restricted ones surface as "Cannot access
	// contents of the page" in the extension's error log.
	if (!/^https?:\/\//.test(url) || isRestrictedUrl(url)) {
		return;
	}

	// Mirror the manifest's declarative registration (<all_urls> +
	// all_frames) instead of gating on getConnectorByUrl(tab.url): a
	// tab's TOP url often matches no connector while an embedded player
	// iframe does (scrobble.life wrapping a YouTube embed), and main.js
	// also carries connector-independent pieces (Zingit auth sync, the
	// Keychain broadcast handlers) that must come back after an update
	// orphans the old scripts. main.js no-ops on frames with nothing to
	// do, exactly as it does on normal navigation.

	/**
	 * Important note: We do not check if the script already exists here.
	 * As scripts are always invalidated on reload, and this only runs on install, there is no need.
	 */

	const script = 'content/main.js';
	// Fire-and-forget by design (see attemptInjectTab header — awaiting
	// can hang on sleeping tabs), but we still attach a .catch() to
	// swallow the rejection. Without this, Chrome reports any failure
	// as "Uncaught (in promise)" in chrome://extensions, which scares
	// users who open the page. Errors here are non-fatal: the target
	// tab just won't have scrobbling until the user navigates within
	// it, which retriggers injection via the declarative content_script
	// matchers in the manifest.
	browser.scripting
		.executeScript({
			target: { tabId, allFrames: true },
			files: [script],
		})
		.catch((err) => {
			// Keep the message in console.debug so devs can still see it
			// when actively debugging, but users won't see anything in
			// chrome://extensions.
			console.debug(
				`[inject] script injection skipped for tab ${tabId} (${url}):`,
				err?.message ?? err,
			);
		});
}

/**
 * Attempts to inject content script into all tabs.
 * Ran on extension load, as whenever the extension is updated or reloaded
 * all content scripts are invalidated and stop working.
 * So we need to replace them.
 */
export async function attemptInjectAllTabs() {
	const tabs = await browser.tabs?.query({});
	for (const tab of tabs ?? []) {
		try {
			await attemptInjectTab(tab);
		} catch (err) {
			console.warn('Error while injecting into tab: ', err);
		}
	}
}
