import { t } from '@/util/i18n';
import type HiveScrobbler from '@/core/scrobbler/hive/hive-scrobbler';
import type { ScrobblerLabel } from '@/core/object/scrobble-service';
import ScrobbleService from '@/core/object/scrobble-service';
import { Show, createMemo, createResource, onCleanup } from 'solid-js';
import styles from './components.module.scss';
import { debugLog } from '@/util/util';
import browser from 'webextension-polyfill';

/**
 * Component that allows the user to connect their Hive account via Keychain.
 */
export default function Accounts() {
	return (
		<>
			<h1>{t('optionsAccounts')}</h1>
			<ScrobblerDisplay label="Hive" />
		</>
	);
}

function ScrobblerDisplay(props: { label: ScrobblerLabel }) {
	const scrobbler = createMemo(() =>
		ScrobbleService.getScrobblerByLabel(props.label),
	);
	const [session, setSession] = createResource(() =>
		scrobbler()?.getSession(),
	);
	const [profileUrl, setProfileUrl] = createResource(() =>
		scrobbler()?.getProfileUrl(),
	);

	const onFocus = async () => {
		try {
			if (await scrobbler()?.isReadyForGrantAccess()) {
				await scrobbler()?.getSession();
				setSession.refetch();
				setProfileUrl.refetch();
			}
		} catch (err) {
			debugLog(`${scrobbler()?.getLabel()}: Error while fetching session`, 'warn');
			debugLog(err, 'warn');
		}
	};
	const onFocusWrapper = () => void onFocus();
	window.addEventListener('focus', onFocusWrapper);
	onCleanup(() => window.removeEventListener('focus', onFocusWrapper));

	return (
		<div role="group" aria-label={scrobbler()?.getLabel()}>
			<h2>{scrobbler()?.getLabel()}</h2>
			<Show
				when={!session.error && session()}
				fallback={
					<button
						class={styles.button}
						onClick={() =>
							void (async () => {
								// Keychain only injects into http/https pages, not extension
								// pages. Build a candidate list — active tab first, then any
								// other http/https tab — so a tab in an error state (Chrome
								// raises "Frame with ID 0 is showing error page" when
								// executeScript hits a failed-to-load tab) falls through to
								// the next candidate instead of failing the whole flow.
								const activeTabs = await browser.tabs.query({
									active: true,
									url: ['http://*/*', 'https://*/*'],
								});
								const otherTabs = await browser.tabs.query({
									url: ['http://*/*', 'https://*/*'],
								});
								const candidates = [
									...activeTabs,
									...otherTabs.filter(
										(t) => !activeTabs.some((a) => a.id === t.id),
									),
								];

								// No usable tab — open scrobble.life and use that. Wait
								// briefly for it to start loading before attempting injection.
								if (candidates.length === 0) {
									const created = await browser.tabs.create({
										url: 'https://scrobble.life',
										active: true,
									});
									if (created.id) {
										await new Promise((r) => setTimeout(r, 1500));
										candidates.push(created);
									}
								}

								let lastErr: unknown = null;
								for (const tab of candidates) {
									if (!tab.id) continue;
									try {
										await (scrobbler() as HiveScrobbler).connect(tab.id);
										setSession.refetch();
										setProfileUrl.refetch();
										return;
									} catch (err) {
										lastErr = err;
										const msg =
											err instanceof Error ? err.message : String(err);
										// Injection failures (error page, restricted URL, frame
										// gone) — try the next candidate. Anything else (Keychain
										// rejected, user closed popup, network) is real, surface
										// it and stop.
										if (
											msg.includes('error page') ||
											msg.includes('Cannot access') ||
											msg.includes('Frame with ID') ||
											msg.includes('No tab with id')
										) {
											continue;
										}
										alert(`Connection failed: ${msg}`);
										return;
									}
								}
								alert(
									`Connection failed — every open tab refused script injection. Open https://scrobble.life or any music site in a fresh tab and try again.${
										lastErr instanceof Error
											? `\n\n(${lastErr.message})`
											: ''
									}`,
								);
							})()
						}
					>
						{t('hiveConnectWithKeychain')}
					</button>
				}
			>
				<p>{t('accountsSignedInAs', session()?.sessionName || 'anonymous')}</p>
				<div class={styles.buttonContainer}>
					<a
						class={styles.button}
						href={profileUrl.error ? '#' : profileUrl()}
						target="_blank"
						rel="noopener noreferrer"
					>
						{t('accountsProfile')}
					</a>
					<button
						class={styles.button}
						onClick={() =>
							void (async () => {
								await scrobbler()?.signOut();
								setSession.refetch();
								setProfileUrl.refetch();
							})()
						}
					>
						{t('accountsSignOut')}
					</button>
				</div>
			</Show>
		</div>
	);
}
