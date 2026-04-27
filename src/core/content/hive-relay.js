/**
 * Hobbles Hive relay — injected on-demand into the MAIN world of the active music tab.
 * Calls window.hive_keychain and relays results back to the ISOLATED content script
 * via window.postMessage.
 *
 * Messages in:  { __hobbles: true, type, id, payload? }
 * Messages out: { __hobbles: true, type: '<type>Result', id, ... }
 */
(function () {
	'use strict';

	// Guard against duplicate installs: injectRelay() runs on every broadcast,
	// and every run would otherwise add another `message` listener. With N
	// listeners, a single hiveBroadcast triggers N requestCustomJson calls →
	// N duplicate transactions on-chain.
	if (window.__hobbles_relay_installed) return;
	window.__hobbles_relay_installed = true;

	window.addEventListener('message', function (event) {
		if (event.source !== window) return;
		var d = event.data;
		if (!d || !d.__hobbles) return;

		var kc = window.hive_keychain;

		if (d.type === 'hiveConnect') {
			var id = d.id;
			if (!kc) {
				window.postMessage(
					{
						__hobbles: true,
						type: 'hiveConnectResult',
						id: id,
						error: 'Hive Keychain extension not detected. Please install it.',
					},
					'*',
				);
				return;
			}
			kc.requestSignBuffer(
				null,
				'Connect to Hobbles',
				'Posting',
				function (response) {
					if (
						response.success &&
						response.data &&
						response.data.username
					) {
						window.postMessage(
							{
								__hobbles: true,
								type: 'hiveConnectResult',
								id: id,
								username: response.data.username,
							},
							'*',
						);
					} else {
						window.postMessage(
							{
								__hobbles: true,
								type: 'hiveConnectResult',
								id: id,
								error: response.message || 'Keychain authentication failed',
							},
							'*',
						);
					}
				},
			);
		}

		if (d.type === 'hiveBroadcast') {
			var reqId = d.id;
			var p = d.payload || {};
			if (!kc) {
				window.postMessage(
					{
						__hobbles: true,
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
							__hobbles: true,
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
