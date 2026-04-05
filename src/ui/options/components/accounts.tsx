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
								// Keychain only injects into http/https pages, not extension pages.
								// Find a suitable tab to relay the Keychain popup through.
								let tabs = await browser.tabs.query({
									active: true,
									url: ['http://*/*', 'https://*/*'],
								});
								if (tabs.length === 0) {
									tabs = await browser.tabs.query({
										url: ['http://*/*', 'https://*/*'],
									});
								}
								const tabId = tabs[0]?.id;
								if (!tabId) {
									alert(
										'Please open a web page in a tab first, then try connecting.',
									);
									return;
								}
								try {
									await (scrobbler() as HiveScrobbler).connect(tabId);
									setSession.refetch();
									setProfileUrl.refetch();
								} catch (err) {
									alert(
										`Connection failed: ${err instanceof Error ? err.message : String(err)}`,
									);
								}
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
