import { getConnectorByUrl } from '../../util/util-connector';
import BaseConnector from '@/core/content/connector';
import * as Util from '@/core/content/util';
import * as MetadataFilter from '@web-scrobbler/metadata-filter';
import start from '@/core/content/starter';
import browser from 'webextension-polyfill';
import {
	sendContentMessage,
	setupContentListeners,
	contentListener,
} from '@/util/communication';
import savedEdits from '../storage/saved-edits';
import regexEdits from '../storage/regex-edits';

/**
 * Relay hiveConnect requests from the background to the MAIN world (hive-relay.js)
 * via window.postMessage, then return the result.
 * Registered on all pages so "Connect with Keychain" can use any open http/https tab.
 */
setupContentListeners(
	contentListener({
		type: 'hiveConnect',
		fn: async () => {
			return new Promise<string>((resolve, reject) => {
				const id = crypto.randomUUID();
				function onMessage(event: MessageEvent) {
					if (
						event.source !== window ||
						!event.data?.__hobbles ||
						event.data.type !== 'hiveConnectResult' ||
						event.data.id !== id
					) {
						return;
					}
					window.removeEventListener('message', onMessage);
					if (event.data.error) {
						reject(new Error(event.data.error as string));
					} else {
						resolve(event.data.username as string);
					}
				}
				window.addEventListener('message', onMessage);
				window.postMessage(
					{ __hobbles: true, type: 'hiveConnect', id },
					'*',
				);
			});
		},
	}),
);

main();
async function main() {
	updateTheme();
	try {
		await fetchConnector();
		start();
	} catch (err) {
		if (err instanceof Error && err.message === 'dontlog') {
			return;
		}
		Util.debugLog(err, 'error');
	}
}

/**
 * Check for a connector that fits the current URL, and bind it if it exists.
 * Also, set up window variables for use in connector scripts.
 */
async function fetchConnector(): Promise<void> {
	const connector = await getConnectorByUrl(window.location.href);
	if (!connector) {
		throw new Error('dontlog');
	}

	// Don't run the connector in frames if it's not allowed to run in frames
	if (window !== top && !connector.allFrames) {
		throw new Error('dontlog');
	}

	window.Connector = new BaseConnector(connector);
	window.Util = Util;
	window.MetadataFilter = MetadataFilter;
	window.webScrobblerScripts = {};
	savedEdits.init();
	regexEdits.init();

	try {
		await import(browser.runtime.getURL(`connectors/${connector?.js}`));
		Util.debugLog(`Successfully loaded ${connector.label} connector`);
	} catch (err) {
		Util.debugLog(
			`An error occurred while loading ${connector.label} connector`,
			'error',
		);
		throw err;
	}
}

/**
 * Updates the browser preferred theme in storage for icon theming.
 */
function updateTheme() {
	const theme = window.matchMedia('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light';
	sendContentMessage({
		type: 'updateTheme',
		payload: theme,
	});
}
