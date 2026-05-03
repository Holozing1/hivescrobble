import type { Resource, ResourceActions } from 'solid-js';
import browser from 'webextension-polyfill';
import { Checkbox } from '../inputs';
import * as BrowserStorage from '@/core/storage/browser-storage';
import * as Options from '@/core/storage/options';
import ScrobbleService from '@/core/object/scrobble-service';
import HiveScrobbler from '@/core/scrobbler/hive/hive-scrobbler';

const globalOptions = BrowserStorage.getStorage(BrowserStorage.OPTIONS);

/**
 * On toggle-flip from OFF→ON, ensure the privacy secret is derived (and
 * cached) up-front so subsequent scrobbles broadcast silently. Throws if
 * Keychain is missing/rejected — caller reverts the toggle.
 */
async function ensurePrivacySecret(): Promise<void> {
	const hive = ScrobbleService.getScrobblerByLabel('Hive') as
		| HiveScrobbler
		| null;
	if (!hive) throw new Error('Hive scrobbler not loaded');

	// Find a usable http(s) tab to inject the Keychain relay into.
	const tabs = await browser.tabs.query({});
	const candidates = tabs.filter(
		(t) => t.id != null && t.url && /^https?:/.test(t.url),
	);
	if (candidates.length === 0) {
		throw new Error(
			'Open scrobble.life or any music site in another tab first — privacy setup needs an http(s) tab to reach Keychain.',
		);
	}

	let lastErr: unknown = null;
	for (const tab of candidates) {
		if (!tab.id) continue;
		try {
			await hive.ensurePrivacySecret(tab.id);
			return;
		} catch (err) {
			lastErr = err;
			const msg = err instanceof Error ? err.message : String(err);
			if (
				msg.includes('error page') ||
				msg.includes('Cannot access') ||
				msg.includes('Frame with ID') ||
				msg.includes('No tab with id')
			) {
				continue;
			}
			throw err;
		}
	}
	throw new Error(
		`Privacy setup failed — every open tab refused script injection.${
			lastErr instanceof Error ? `\n\n(${lastErr.message})` : ''
		}`,
	);
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
	const setKey = async (
		key: keyof Options.GlobalOptions,
		value: boolean,
	) => {
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
			if (!o) return o;
			const updated = { ...o, [key]: value };
			globalOptions.set(updated);
			return updated;
		});
	};

	return (
		<>
			<h2 id="header-privacy">Privacy</h2>
			<p style={{ 'font-size': '0.9em', 'opacity': 0.85, 'margin-top': '0.25rem' }}>
				When ON, scrobbles of that kind broadcast an encrypted blob to Hive instead
				of artist + title. Only you can decrypt your own history (using your
				posting key, no extra setup needed). Public chart contributions and
				community stats skip these scrobbles.
			</p>

			<Checkbox
				title="Encrypt music scrobbles (Spotify, YouTube Music, SoundCloud, etc.)"
				label="Private music"
				isChecked={() => props.options()?.[Options.HIVE_PRIVACY_MUSIC] ?? false}
				onInput={(e) => {
					void setKey(Options.HIVE_PRIVACY_MUSIC, e.currentTarget.checked);
				}}
			/>

			<Checkbox
				title="Encrypt non-music YouTube videos (vlogs, news, comedy — videos auto-scrobbled by the YouTube connector)"
				label="Private videos"
				isChecked={() => props.options()?.[Options.HIVE_PRIVACY_VIDEOS] ?? false}
				onInput={(e) => {
					void setKey(Options.HIVE_PRIVACY_VIDEOS, e.currentTarget.checked);
				}}
			/>

			<Checkbox
				title="Encrypt movies & TV scrobbles (Netflix, Disney+, Max, Prime Video, manual entries)"
				label="Private movies & TV"
				isChecked={() => props.options()?.[Options.HIVE_PRIVACY_MOVIES_TV] ?? false}
				onInput={(e) => {
					void setKey(Options.HIVE_PRIVACY_MOVIES_TV, e.currentTarget.checked);
				}}
			/>

			<Checkbox
				title="Encrypt podcast scrobbles (Overcast, Pocket Casts, Spotify shows)"
				label="Private podcasts"
				isChecked={() => props.options()?.[Options.HIVE_PRIVACY_PODCASTS] ?? false}
				onInput={(e) => {
					void setKey(Options.HIVE_PRIVACY_PODCASTS, e.currentTarget.checked);
				}}
			/>
		</>
	);
}
