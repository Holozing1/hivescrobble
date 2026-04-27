import { ISSUES_URL, t } from '@/util/i18n';

/**
 * Component that shows some frequently asked questions
 */
export default function FAQ() {
	return (
		<>
			<h1>{t('faqTitle')}</h1>

			<h2>{t('faqQuestion1')}</h2>
			<p>{t('faqAnswer1')}</p>

			<h2>{t('faqQuestion2')}</h2>
			<p>{t('faqAnswer2')}</p>

			<h2>{t('faqQuestion3')}</h2>
			<p>{t('faqAnswer3')}</p>

			<h2>{t('faqQuestion4')}</h2>
			<p>{t('faqAnswer4')}</p>

			<h2>{t('faqQuestion5')}</h2>
			<p innerHTML={t('faqAnswer5', ISSUES_URL)} />

			<h2>{t('faqQuestion6')}</h2>
			<p>{t('faqAnswer6')}</p>
		</>
	);
}
