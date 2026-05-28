/**
 * Hive Scrobbler relay — injected on-demand into the MAIN world of the active music tab.
 * Calls window.hive_keychain and relays results back to the ISOLATED content script
 * via window.postMessage.
 *
 * Messages in:  { __hive_scrobbler: true, type, id, payload? }
 * Messages out: { __hive_scrobbler: true, type: '<type>Result', id, ... }
 */
(function () {
	'use strict';

	// Guard against duplicate installs: injectRelay() runs on every broadcast,
	// and every run would otherwise add another `message` listener. With N
	// listeners, a single hiveBroadcast triggers N requestCustomJson calls →
	// N duplicate transactions on-chain.
	if (window.__hive_scrobbler_relay_installed) {
		return;
	}
	window.__hive_scrobbler_relay_installed = true;

	window.addEventListener('message', function (event) {
		if (event.source !== window) {
			return;
		}
		const d = event.data;
		if (!d || !d.__hive_scrobbler) {
			return;
		}

		const kc = window.hive_keychain;

		if (d.type === 'hiveConnect') {
			const id = d.id;
			if (!kc) {
				window.postMessage(
					{
						__hive_scrobbler: true,
						type: 'hiveConnectResult',
						id,
						error: 'Hive Keychain extension not detected. Please install it.',
					},
					'*',
				);
				return;
			}
			kc.requestSignBuffer(
				null,
				'Connect to Hive Scrobbler',
				'Posting',
				function (response) {
					if (
						response.success &&
						response.data &&
						response.data.username
					) {
						window.postMessage(
							{
								__hive_scrobbler: true,
								type: 'hiveConnectResult',
								id,
								username: response.data.username,
							},
							'*',
						);
					} else {
						window.postMessage(
							{
								__hive_scrobbler: true,
								type: 'hiveConnectResult',
								id,
								error:
									response.message ||
									'Keychain authentication failed',
							},
							'*',
						);
					}
				},
			);
		}

		// NOTE: privacy-key signing is intentionally NOT handled here. It must
		// not transit the page via window.postMessage (any co-resident script
		// could read the signature and derive the AES key). It runs via a
		// direct MAIN-world executeScript call on scrobble.life instead — see
		// privacy-secret.ts:signChallenge.

		if (d.type === 'hiveBroadcast') {
			const reqId = d.id;
			const p = d.payload || {};
			if (!kc) {
				window.postMessage(
					{
						__hive_scrobbler: true,
						type: 'hiveBroadcastResult',
						id: reqId,
						success: false,
					},
					'*',
				);
				return;
			}
			kc.requestCustomJson(
				p.username,
				p.id,
				'Posting',
				p.json,
				p.displayMsg,
				function (response) {
					window.postMessage(
						{
							__hive_scrobbler: true,
							type: 'hiveBroadcastResult',
							id: reqId,
							success: !!(response && response.success),
						},
						'*',
					);
				},
			);
		}
	});
})();
