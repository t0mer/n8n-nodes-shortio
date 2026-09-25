import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { compact, toIsoDate, unwrapOrSuccess } from '../../../../shared/fields';
import {
	LINK_ID_REGEX,
	parseShortUrl,
	resolveDomainId,
	resolveLink,
	resolveLinkId,
	resolvePositiveInt,
} from '../../../../shared/locators';
import { shortIoRequest, type ShortIoRequest } from '../../../../shared/transport';
import type { OperationEntry } from '../../../../shared/types';
import {
	buildPeriod,
	buildStatsFilters,
	buildTimezone,
	isAfter,
	toLinkClicksInstant,
} from '../../descriptions/statistics';

const LINK_ID_RE = new RegExp(LINK_ID_REGEX);

/**
 * `POST link_clicks` with `pathsDates` matches only the bare link path (no scheme, host, leading
 * slash, query string or fragment); a full short URL or a `/`-prefixed path returns 0 silently
 * (Part C evidence). Handles two input shapes consistently:
 * - A full URL (has a `scheme://`) or a scheme-less `host/path` (its first `/`-separated segment
 *   contains a `.`, e.g. `2l0h.short.gy/abc123`) is parsed with {@link parseShortUrl} and only its
 *   `.path` is kept — the host is discarded, since this endpoint takes no domain.
 * - Anything else is treated as an already-bare path: a query string or fragment and a leading or
 *   trailing slash are stripped, then it's percent-decoded (kept as-is on a malformed sequence,
 *   same fallback as `parseShortUrl`).
 */
function bareClickPath(raw: string): string {
	const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
	const firstSegment = raw.split('/')[0];
	const looksLikeHost = !hasScheme && raw.includes('/') && firstSegment.includes('.');
	if (hasScheme || looksLikeHost) {
		return parseShortUrl(raw).path;
	}

	const bare = raw.split(/[?#]/)[0].replace(/^\/+/, '').replace(/\/+$/, '');
	try {
		return decodeURIComponent(bare);
	} catch {
		return bare;
	}
}

/** Period, tz and include/exclude filters for item `i`, all validated locally. */
function commonParams(this: IExecuteFunctions, i: number) {
	const tz = buildTimezone(this, i);
	const period = buildPeriod(this, i, tz);
	const filters = buildStatsFilters(this.getNodeParameter('filters', i, {}), tz);
	return { period, tz, filters, hasFilters: Object.keys(filters).length > 0 };
}

function statsRequest(this: IExecuteFunctions, req: Omit<ShortIoRequest, 'host'>): Promise<unknown> {
	return shortIoRequest.call(this, { ...req, host: 'statistics' });
}

/** Array responses become one item per element; anything else is one item. */
function toItems(this: IExecuteFunctions, response: unknown): INodeExecutionData[] {
	if (Array.isArray(response)) return this.helpers.returnJsonArray(response as IDataObject[]);
	return this.helpers.returnJsonArray(unwrapOrSuccess(response));
}

async function getDomainStatistics(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const { period, tz, filters, hasFilters } = commonParams.call(this, i);
	const options = this.getNodeParameter('options', i, {}) as {
		clicksChartInterval?: string;
		skipTops?: boolean;
	};
	const domainId = resolveDomainId(this.getNodeParameter('domain', i));

	const fields = compact({ ...period, tz, clicksChartInterval: options.clicksChartInterval });
	// GET takes no filters and no skipTops (statistics digest §2.1); POST takes both (§2.2).
	const usePost = hasFilters || options.skipTops !== undefined;
	const response = await statsRequest.call(this, {
		method: usePost ? 'POST' : 'GET',
		path: `/domain/${domainId}`,
		...(usePost
			? { body: compact({ ...fields, ...filters, skipTops: options.skipTops }) }
			: { qs: fields }),
		resource: 'domain',
		itemIndex: i,
	});
	return toItems.call(this, response);
}

async function getDomainStatisticsByInterval(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const { period, tz, filters } = commonParams.call(this, i);
	const clicksChartInterval = this.getNodeParameter('clicksChartInterval', i, '') as string;
	const domainId = resolveDomainId(this.getNodeParameter('domain', i));

	const response = await statsRequest.call(this, {
		method: 'POST',
		path: `/domain/${domainId}/by_interval`,
		body: compact({ ...period, tz, clicksChartInterval, ...filters }),
		resource: 'domain',
		itemIndex: i,
	});
	return toItems.call(this, response);
}

async function getDomainTopValues(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const { period, tz, filters } = commonParams.call(this, i);
	const column = this.getNodeParameter('column', i) as string;
	const limit = this.getNodeParameter('limit', i, 50) as number;
	const prefix = this.getNodeParameter('prefix', i, '') as string;
	const domainId = resolveDomainId(this.getNodeParameter('domain', i));

	const response = await statsRequest.call(this, {
		method: 'POST',
		path: `/domain/${domainId}/top`,
		body: compact({ column, limit, prefix, ...period, tz, ...filters }),
		resource: 'domain',
		itemIndex: i,
	});
	return toItems.call(this, response);
}

async function getLinkClicks(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const identifyBy = this.getNodeParameter('identifyBy', i, 'id') as string;
	// Get Link Clicks has no Timezone parameter of its own.
	const tz = this.getTimezone();
	const dateRange = this.getNodeParameter('dateRange', i, {}) as IDataObject;
	const startDate = toLinkClicksInstant(dateRange.startDate, tz);
	const endDate = toLinkClicksInstant(dateRange.endDate, tz);
	if (startDate !== undefined && endDate !== undefined && isAfter(startDate, endDate)) {
		throw new NodeOperationError(
			this.getNode(),
			`Start Date (${startDate}) must not be after End Date (${endDate})`,
			{ itemIndex: i },
		);
	}
	// link_clicks takes only startDate/endDate in the query, for both GET and POST (digest §2.6-2.7).
	const dateQs = compact({ startDate, endDate });

	let req: Omit<ShortIoRequest, 'host' | 'path'>;
	if (identifyBy === 'path') {
		const raw = this.getNodeParameter('pathsDates', i, {}) as { link?: IDataObject[] };
		const pathsDates = (raw.link ?? []).map((entry) => {
			const rawPath = String(entry.path ?? '').trim();
			if (!rawPath) {
				throw new NodeOperationError(this.getNode(), 'Every link needs a Path or Short URL', {
					itemIndex: i,
				});
			}
			let path: string;
			try {
				path = bareClickPath(rawPath);
			} catch (error) {
				throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex: i });
			}
			if (!path) {
				throw new NodeOperationError(this.getNode(), `"${rawPath}" is missing a path`, {
					itemIndex: i,
				});
			}
			// The API returns 400 without createdAt on every entry, so it isn't optional here.
			const createdAt = toLinkClicksInstant(entry.createdAt, tz);
			if (createdAt === undefined) {
				throw new NodeOperationError(this.getNode(), `"${rawPath}" needs a Created At`, {
					itemIndex: i,
				});
			}
			return { path, createdAt };
		});
		if (pathsDates.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Add at least one link', { itemIndex: i });
		}
		req = { method: 'POST', qs: dateQs, body: { pathsDates } };
	} else {
		const ids = String(this.getNodeParameter('linkIds', i, '') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		if (ids.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Add at least one link ID', { itemIndex: i });
		}
		for (const id of ids) {
			if (!LINK_ID_RE.test(id)) {
				throw new NodeOperationError(this.getNode(), `"${id}" is not a valid link ID`, {
					itemIndex: i,
				});
			}
		}
		req = { method: 'GET', qs: { ids: ids.join(','), ...dateQs } };
	}

	const domainId = resolveDomainId(this.getNodeParameter('domain', i));
	const response = await statsRequest.call(this, {
		...req,
		path: `/domain/${domainId}/link_clicks`,
		resource: 'domain',
		itemIndex: i,
	});
	return this.helpers.returnJsonArray(unwrapOrSuccess(response));
}

async function getRawClicks(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const { period, tz, filters } = commonParams.call(this, i);
	const limit = this.getNodeParameter('limit', i, 50) as number;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	// Pagination cursors keep their full date-time: raw click `dt` values have millisecond precision.
	const beforeDate = toIsoDate(options.beforeDate);
	const afterDate = toIsoDate(options.afterDate);
	const domainId = resolveDomainId(this.getNodeParameter('domain', i));

	const response = await statsRequest.call(this, {
		method: 'POST',
		path: `/domain/${domainId}/last_clicks`,
		body: compact({ limit, beforeDate, afterDate, ...period, tz, ...filters }),
		resource: 'domain',
		itemIndex: i,
	});

	// Documented as a single LastClick object but described as a list (digest §2.9): accept an
	// array, an object wrapping an array, or a lone object.
	if (response !== null && typeof response === 'object' && !Array.isArray(response)) {
		const nested = Object.values(response as IDataObject).find((v) => Array.isArray(v));
		if (nested) return this.helpers.returnJsonArray(nested as IDataObject[]);
	}
	return toItems.call(this, response);
}

async function getLinkStatistics(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const { period, tz, filters, hasFilters } = commonParams.call(this, i);
	const options = this.getNodeParameter('options', i, {}) as {
		clicksChartInterval?: string;
		skipTops?: boolean;
	};
	const linkId = await resolveLinkId.call(this, this.getNodeParameter('link', i), i);

	// Both GET (query) and POST (body) accept skipTops on link stats (statistics digest §2.11-2.12).
	const fields = compact({
		...period,
		tz,
		clicksChartInterval: options.clicksChartInterval,
		skipTops: options.skipTops,
	});
	const response = await statsRequest.call(this, {
		method: hasFilters ? 'POST' : 'GET',
		path: `/link/${encodeURIComponent(linkId)}`,
		...(hasFilters ? { body: { ...fields, ...filters } } : { qs: fields }),
		resource: 'link',
		itemIndex: i,
	});
	return toItems.call(this, response);
}

async function getLinkStatisticsByInterval(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const { period, tz, filters } = commonParams.call(this, i);
	const clicksChartInterval = this.getNodeParameter('clicksChartInterval', i, '') as string;
	const linkId = await resolveLinkId.call(this, this.getNodeParameter('link', i), i);

	const response = await statsRequest.call(this, {
		method: 'POST',
		path: `/link/${encodeURIComponent(linkId)}/by_interval`,
		body: compact({ ...period, tz, clicksChartInterval, ...filters }),
		resource: 'link',
		itemIndex: i,
	});
	return toItems.call(this, response);
}

/**
 * `POST /statistics/link/{id}/top` returns 404 "Link undefined not found" for every id format on
 * the live API (Part C evidence). The documented workaround is Get Domain Top Values scoped to
 * just this link's path: resolve the link's `path`/`DomainId` (reusing the `/links/expand` result
 * when the locator's `url` mode already fetched one; otherwise `GET /links/{id}`), then narrow (or
 * intersect, if the user already set an Include Paths filter) the request to that one path. Throws
 * if Short.io's own link response is missing a domain or path — it's meant to always have both.
 */
async function getLinkTopValues(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const { period, tz, filters } = commonParams.call(this, i);
	const column = this.getNodeParameter('column', i) as string;
	const limit = this.getNodeParameter('limit', i, 50) as number;

	// In `url` mode, resolveLink's /links/expand already returned the full link object; reuse it
	// instead of a second GET /links/{id}. In `id` mode it only has `idString` (no HTTP call was
	// made yet), so a request is still needed.
	const resolved = await resolveLink.call(this, this.getNodeParameter('link', i), i);
	const link =
		typeof resolved.path === 'string' && resolved.DomainId !== undefined
			? resolved
			: ((await shortIoRequest.call(this, {
					method: 'GET',
					path: `/links/${encodeURIComponent(resolved.idString)}`,
					resource: 'link',
					itemIndex: i,
				})) as IDataObject);

	if (
		typeof link.path !== 'string' ||
		link.path === '' ||
		link.DomainId === undefined ||
		link.DomainId === null
	) {
		throw new NodeOperationError(
			this.getNode(),
			`Short.io returned link ${resolved.idString} without a domain or path`,
			{ itemIndex: i },
		);
	}
	const domainId = resolvePositiveInt.call(this, String(link.DomainId), 'Domain ID', i);
	const linkPath = `/${link.path}`;

	const userPaths = (filters.include?.paths as string[] | undefined)?.map((p) =>
		p.startsWith('/') ? p : `/${p}`,
	);
	if (userPaths !== undefined && !userPaths.includes(linkPath)) return [];

	const include = { ...filters.include, paths: [linkPath] };

	const response = await statsRequest.call(this, {
		method: 'POST',
		path: `/domain/${domainId}/top`,
		body: compact({ column, limit, ...period, tz, ...filters, include }),
		resource: 'domain',
		itemIndex: i,
	});
	return toItems.call(this, response);
}

export const statisticsHandlers: Record<string, OperationEntry> = {
	getDomainStatistics: { kind: 'item', run: getDomainStatistics },
	getDomainStatisticsByInterval: { kind: 'item', run: getDomainStatisticsByInterval },
	getDomainTopValues: { kind: 'item', run: getDomainTopValues },
	getLinkClicks: { kind: 'item', run: getLinkClicks },
	getLinkStatistics: { kind: 'item', run: getLinkStatistics },
	getLinkStatisticsByInterval: { kind: 'item', run: getLinkStatisticsByInterval },
	getLinkTopValues: { kind: 'item', run: getLinkTopValues },
	getRawClicks: { kind: 'item', run: getRawClicks },
};
