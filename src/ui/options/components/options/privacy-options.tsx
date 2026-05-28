import type { Resource, ResourceActions } from 'solid-js';
import browser from 'webextension-polyfill';
import { Checkbox } from '../inputs';
import * as BrowserStorage from '@/core/storage/browser-storage';
import * as Options from '@/core/storage/options';
import ScrobbleService from '@/core/object/scrobble-service';
import HiveScrobbler from '@/core/scrobbler/hive/hive-scrobbler';

const globalOptions = BrowserStorage.getStorage(BrowserStorage.OPTIONS);

const SCROBBLE_LIFE_URL = 'https://scrobble.life/';
const SCROBBLE_LIFE_HOSTS = ['scrobble.life', 'www.scrobble.life'];

function isScrobbleLifeUrl(url: string | undefined): boolean {
	if (!url) {
		return false;
	}
	try {
		return SCROBBLE_LIFE_HOSTS.includes(new URL(url).hostname);
	} catch {
		return false;
	}
}

/** Poll until the tab finishes loading (so Keychain has injected). */
async function waitForTabComplete(
	tabId: number,
	timeoutMs = 20000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const tab = await browser.tabs.get(tabId);
		if (tab.status === 'complete') {
			return;
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error('scrobble.life took too long to load');
}

/**
 * SECURITY: the privacy key is derived from a posting-key signature, and
 * anything that transits a page's MAIN world is readable by that page. So we
 * only ever sign on a trusted origin we control — scrobble.life — never an
 * arbitrary open tab. Reuse an existing scrobble.life tab if one is open,
 * otherwise open one and wait for it to load.
 */
async function getOrOpenScrobbleLifeTab(): Promise<number> {
	const tabs = await browser.tabs.query({});
	const existing = tabs.find((t) => t.id != null && isScrobbleLifeUrl(t.url));
	if (existing?.id != null) {
		await browser.tabs.update(existing.id, { active: true });
		return existing.id;
	}
	const created = await browser.tabs.create({
		url: SCROBBLE_LIFE_URL,
		active: true,
	});
	if (created.id == null) {
		throw new Error(
			'Could not open a scrobble.life tab for privacy setup.',
		);
	}
	await waitForTabComplete(created.id);
	// Keychain injects window.hive_keychain shortly after load — give it a beat.
	await new Promise((r) => setTimeout(r, 800));
	return created.id;
}

/**
 * On toggle-flip from OFF→ON, ensure the privacy secret is derived (and
 * cached) up-front so subsequent scrobbles broadcast silently. Throws if
 * Keychain is missing/rejected — caller reverts the toggle.
 */
async function ensurePrivacySecret(): Promise<void> {
	const hive = ScrobbleService.getScrobblerByLabel(
		'Hive',
	) as HiveScrobbler | null;
	if (!hive) {
		throw new Error('Hive scrobbler not loaded');
	}
	const tabId = await getOrOpenScrobbleLifeTab();
	await hive.ensurePrivacySecret(tabId);
}

/**
 * Tier-B privacy toggles, one per kind. When ON, scrobbles of that kind
 * are broadcast as encrypted blobs (artist/title hidden from public Hive
 * observers; only the user themselves can decrypt their own history via
 * the privacy secret derived from their posting key).
 *
 * Storage-only at this stage — the broadcast pipeline still emits public
 * payloads regardless of these flags. Wiring them through
 * `hive-scrobbler.ts:broadcastScrobble` is the next step.
 */
export default function PrivacyOptions(props: {
	options: Resource<Options.GlobalOptions | null>;
	setOptions: ResourceActions<
		Options.GlobalOptions | null | undefined,
		unknown
	>;
}) {
	const setKey = async (key: keyof Options.GlobalOptions, value: boolean) => {
		// On any OFF→ON flip, derive the privacy secret first so subsequent
		// scrobbles broadcast silently. If derivation fails (Keychain
		// rejected, no http tab), revert the toggle so we never end up in a
		// state where privacy is "on" but encryption can't actually run.
		const isFirstEnable =
			value &&
			!props.options()?.[Options.HIVE_PRIVACY_MUSIC] &&
			!props.options()?.[Options.HIVE_PRIVACY_VIDEOS] &&
			!props.options()?.[Options.HIVE_PRIVACY_MOVIES_TV] &&
			!props.options()?.[Options.HIVE_PRIVACY_PODCASTS];
		if (isFirstEnable) {
			try {
				await ensurePrivacySecret();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				alert(`Couldn't enable privacy mode: ${msg}`);
				return;
			}
		}

		props.setOptions.mutate((o) => {
			if (!o) {
				return o;
			}
			const updated = { ...o, [key]: value };
			globalOptions.set(updated);
			return updated;
		});
	};

	return (
		<>
			<h2 id="header-privacy">Privacy</h2>
			<p
				style={{
					'font-size': '0.9em',
					opacity: 0.85,
					'margin-top': '0.25rem',
				}}
			>
				When ON, scrobbles of that kind broadcast an encrypted blob to
				Hive instead of artist + title. Only you can decrypt your own
				history (using your posting key, no extra setup needed). Public
				chart contributions and community stats skip these scrobbles.
			</p>

			<Checkbox
				title="Encrypt music scrobbles (Spotify, YouTube Music, SoundCloud, etc.)"
				label="Private music"
				isChecked={() =>
					props.options()?.[Options.HIVE_PRIVACY_MUSIC] ?? false
				}
				onInput={(e) => {
					void setKey(
						Options.HIVE_PRIVACY_MUSIC,
						e.currentTarget.checked,
					);
				}}
			/>

			<Checkbox
				title="Encrypt non-music YouTube videos (vlogs, news, comedy — videos auto-scrobbled by the YouTube connector)"
				label="Private videos"
				isChecked={() =>
					props.options()?.[Options.HIVE_PRIVACY_VIDEOS] ?? false
				}
				onInput={(e) => {
					void setKey(
						Options.HIVE_PRIVACY_VIDEOS,
						e.currentTarget.checked,
					);
				}}
			/>

			<Checkbox
				title="Encrypt movies & TV scrobbles (Netflix, Disney+, Max, Prime Video, manual entries)"
				label="Private movies & TV"
				isChecked={() =>
					props.options()?.[Options.HIVE_PRIVACY_MOVIES_TV] ?? false
				}
				onInput={(e) => {
					void setKey(
						Options.HIVE_PRIVACY_MOVIES_TV,
						e.currentTarget.checked,
					);
				}}
			/>

			<Checkbox
				title="Encrypt podcast scrobbles (Overcast, Pocket Casts, Spotify shows)"
				label="Private podcasts"
				isChecked={() =>
					props.options()?.[Options.HIVE_PRIVACY_PODCASTS] ?? false
				}
				onInput={(e) => {
					void setKey(
						Options.HIVE_PRIVACY_PODCASTS,
						e.currentTarget.checked,
					);
				}}
			/>
		</>
	);
}
