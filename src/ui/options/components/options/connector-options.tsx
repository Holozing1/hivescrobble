import { createResource } from 'solid-js';
import * as BrowserStorage from '@/core/storage/browser-storage';
import styles from '../components.module.scss';
import { ConnectorOptionEntry } from '../inputs';
import { t } from '@/util/i18n';

const connectorOptions = BrowserStorage.getStorage(
	BrowserStorage.CONNECTORS_OPTIONS,
);

const [options, setOptions] = createResource(
	connectorOptions.get.bind(connectorOptions),
);

/**
 * Component that shows the options specific to only a certain connector.
 */
export default function ConnectorOptionsList() {
	return (
		<>
			<h2>YouTube</h2>
			<ul class={styles.optionList}>
				<ConnectorOptionEntry
					options={options}
					setOptions={setOptions}
					connectorOptions={connectorOptions}
					i18ntitle="optionYtMusicOnlyTitle"
					i18nlabel="optionYtMusicOnly"
					connector="YouTube"
					key="scrobbleMusicOnly"
				/>
				<ConnectorOptionEntry
					options={options}
					setOptions={setOptions}
					connectorOptions={connectorOptions}
					i18ntitle="optionYtEntertainmentOnlyTitle"
					i18nlabel="optionYtEntertainmentOnly"
					connector="YouTube"
					key="scrobbleEntertainmentOnly"
				/>
				<ConnectorOptionEntry
					options={options}
					setOptions={setOptions}
					connectorOptions={connectorOptions}
					i18ntitle="optionYtNonMusicVideosTitle"
					i18nlabel="optionYtNonMusicVideos"
					connector="YouTube"
					key="scrobbleNonMusicVideos"
				/>
				<li class={styles.muted}>{t('optionYtDesc')}</li>
			</ul>
		</>
	);
}
