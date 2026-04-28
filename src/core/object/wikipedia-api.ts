/**
 * Wikipedia + Wikidata client for movie/TV metadata.
 *
 * Replaces the prior TMDB integration. Wikipedia is unambiguously free
 * for any use, no auth, no commercial-use clause. Coverage is comprehensive
 * for notable theatrical releases and TV series; indie films may be sparse.
 *
 * Data flow when called from the metadata pipeline stage:
 *   1. opensearch    — fast title autocomplete (top N candidate titles)
 *   2. batched query — descriptions + extracts for those titles, used to
 *                      filter out non-film/TV pages and parse year
 *   3. summary on resolution — REST summary for the picked candidate to
 *                      pull the poster image (pageimages is unreliable for
 *                      film/TV pages — we use /api/rest_v1/page/summary
 *                      which is consistent)
 *   4. Wikidata SPARQL (optional) — IMDb cross-ref for the picked entity
 */

const API = 'https://en.wikipedia.org/w/api.php';
const REST = 'https://en.wikipedia.org/api/rest_v1';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

const UA = 'hive-scrobbler/1.0 (https://scrobble.life)';

export interface WikipediaCandidate {
	title: string;
	description: string;
	extract: string;
	year: number | null;
}

export interface WikipediaSummary {
	title: string;
	description: string;
	extract: string;
	year: number | null;
	url: string;
	pageid: number;
	thumbnailUrl: string | null;
	originalImageUrl: string | null;
}

const KIND_PATTERNS = {
	movie:   /\b(film|movie|motion picture)\b/i,
	episode: /\b(TV series|television series|miniseries|web series|sitcom|drama series|anime series)\b/i,
} as const;

async function jsonFetch<T>(url: string): Promise<T | null> {
	try {
		const res = await fetch(url, { headers: { 'User-Agent': UA } });
		if (!res.ok) return null;
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

async function opensearch(query: string, limit = 8): Promise<string[]> {
	if (!query.trim()) return [];
	const params = new URLSearchParams({
		action:    'opensearch',
		search:    query,
		limit:     String(limit),
		namespace: '0',
		format:    'json',
	});
	const data = await jsonFetch<[string, string[], string[], string[]]>(`${API}?${params.toString()}`);
	return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
}

interface BatchedPage {
	pageid: number;
	title: string;
	description?: string;
	extract?: string;
}

async function batchedQuery(titles: string[]): Promise<BatchedPage[]> {
	if (titles.length === 0) return [];
	const params = new URLSearchParams({
		action:        'query',
		prop:          'extracts|description',
		exintro:       '1',
		explaintext:   '1',
		titles:        titles.join('|'),
		format:        'json',
		formatversion: '2',
	});
	const data = await jsonFetch<{ query?: { pages?: BatchedPage[] } }>(`${API}?${params.toString()}`);
	return data?.query?.pages ?? [];
}

/**
 * Search Wikipedia for movie or TV-series candidates matching the query.
 * Filters out non-film/TV pages by description regex.
 */
export async function searchCandidates(
	kind: 'movie' | 'episode',
	query: string,
): Promise<WikipediaCandidate[]> {
	const titles = await opensearch(query, 8);
	if (titles.length === 0) return [];
	const pages = await batchedQuery(titles);
	const matcher = KIND_PATTERNS[kind];
	const out: WikipediaCandidate[] = [];
	for (const p of pages) {
		const description = p.description ?? '';
		const extract = p.extract ?? '';
		const haystack = `${description}\n${extract.slice(0, 240)}`;
		if (!matcher.test(haystack)) continue;
		out.push({
			title: p.title,
			description,
			extract,
			year: parseYear(description) ?? parseYear(extract),
		});
	}
	return out;
}

/**
 * Fetch the REST summary for a Wikipedia page — gives us the poster URL
 * (the batched query's pageimages prop is unreliable for films/TV).
 */
export async function getSummary(pageTitle: string): Promise<WikipediaSummary | null> {
	const safe = encodeURIComponent(pageTitle.replace(/ /g, '_'));
	type SummaryResponse = {
		type:        string;
		title:       string;
		description?: string;
		extract?:    string;
		pageid:      number;
		thumbnail?:  { source: string; width: number; height: number };
		originalimage?: { source: string; width: number; height: number };
		content_urls?: { desktop?: { page?: string } };
	};
	const data = await jsonFetch<SummaryResponse>(`${REST}/page/summary/${safe}`);
	if (!data) return null;
	const description = data.description ?? '';
	const extract = data.extract ?? '';
	return {
		title:            data.title,
		description,
		extract,
		year:             parseYear(description) ?? parseYear(extract),
		url:              data.content_urls?.desktop?.page
		                  ?? `https://en.wikipedia.org/wiki/${safe}`,
		pageid:           data.pageid,
		thumbnailUrl:     data.thumbnail?.source ?? null,
		originalImageUrl: data.originalimage?.source ?? null,
	};
}

/**
 * Wikidata cross-reference: given a Wikipedia page title, return the IMDb ID
 * if the linked entity has one. Returns null if the lookup fails (network
 * issue, no Wikidata link, no IMDb property). Best-effort enrichment.
 */
export async function getImdbId(pageTitle: string): Promise<string | null> {
	const params = new URLSearchParams({
		action:        'wbgetentities',
		sites:         'enwiki',
		titles:        pageTitle,
		props:         'claims',
		format:        'json',
		formatversion: '2',
	});
	type WikidataResponse = {
		entities?: Record<string, {
			claims?: {
				P345?: {
					mainsnak?: { datavalue?: { value?: string } };
				}[];
			};
		}>;
	};
	const data = await jsonFetch<WikidataResponse>(`${WIKIDATA_API}?${params.toString()}`);
	const entities = data?.entities;
	if (!entities) return null;
	for (const id of Object.keys(entities)) {
		// Skip the special "-1" sentinel (means "no entity matched").
		if (id === '-1') continue;
		const claim = entities[id]?.claims?.P345?.[0];
		const value = claim?.mainsnak?.datavalue?.value;
		if (typeof value === 'string') return value;
	}
	return null;
}

function parseYear(s: string): number | null {
	if (!s) return null;
	const match = /\b(19|20)\d{2}\b/.exec(s);
	if (!match) return null;
	const n = parseInt(match[0], 10);
	const currentYear = new Date().getUTCFullYear();
	if (n < 1880 || n > currentYear + 5) return null;
	return n;
}
