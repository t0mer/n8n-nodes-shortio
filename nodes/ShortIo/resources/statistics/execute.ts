import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { compact, toIsoDate, unwrapOrSuccess } from '../../../../shared/fields';
import { LINK_ID_REGEX, resolveDomainId } from '../../../../shared/locators';
import { shortIoRequest, type ShortIoRequest } from '../../../../shared/transport';
import type { OperationEntry } from '../../../../shared/types';
import {
	buildPeriod,
	buildStatsFilters,
	buildTimezone,
	toStatsDate,
} from '../../descriptions/statistics';

const LINK_ID_RE = new RegExp(LINK_ID_REGEX);

/** Period, tz and include/exclude filters for item `i`, all validated locally. */
function commonParams(this: IExecuteFunctions, i: number) {
	const period = buildPeriod(this, i);
	const tz = buildTimezone(this, i);
	const filters = buildStatsFilters(this.getNodeParameter('filters', i, {}));
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

async function getDomainTopValuesByInterval(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const { period, tz, filters } = commonParams.call(this, i);
	const column = this.getNodeParameter('column', i) as string;
	const interval = this.getNodeParameter('interval', i, '') as string;
	const limit = this.getNodeParameter('limit', i, 50) as number;
	const domainId = resolveDomainId(this.getNodeParameter('domain', i));

	const response = await statsRequest.call(this, {
		method: 'POST',
		path: `/domain/${domainId}/top_by_interval`,
		body: compact({ column, interval, limit, ...period, tz, ...filters }),
		resource: 'domain',
		itemIndex: i,
	});
	return toItems.call(this, response);
}

async function getLinkClicks(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const identifyBy = this.getNodeParameter('identifyBy', i, 'id') as string;
	const dateRange = this.getNodeParameter('dateRange', i, {}) as IDataObject;
	const startDate = toStatsDate(dateRange.startDate);
	const endDate = toStatsDate(dateRange.endDate);
	if (startDate !== undefined && endDate !== undefined && startDate > endDate) {
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
			const path = String(entry.path ?? '').trim();
			if (!path) {
				throw new NodeOperationError(this.getNode(), 'Every link needs a Short URL', {
					itemIndex: i,
				});
			}
			return compact({ path, createdAt: toIsoDate(entry.createdAt) });
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
	// Pagination cursors keep their full date-time: raw click `dt` values have second precision.
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

async function clearDomainStatistics(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const confirm = this.getNodeParameter('confirm', i, false);
	if (confirm !== true) {
		throw new NodeOperationError(
			this.getNode(),
			'Clear Domain Statistics is irreversible. Enable "Confirm" to proceed.',
			{ itemIndex: i },
		);
	}
	const domainId = resolveDomainId(this.getNodeParameter('domain', i));

	const response = await statsRequest.call(this, {
		method: 'DELETE',
		path: `/domain/${domainId}/statistics`,
		resource: 'domain',
		itemIndex: i,
	});
	return this.helpers.returnJsonArray({ success: true, domainId, ...unwrapOrSuccess(response) });
}

export const statisticsHandlers: Record<string, OperationEntry> = {
	clearDomainStatistics: { kind: 'item', run: clearDomainStatistics },
	getDomainStatistics: { kind: 'item', run: getDomainStatistics },
	getDomainStatisticsByInterval: { kind: 'item', run: getDomainStatisticsByInterval },
	getDomainTopValues: { kind: 'item', run: getDomainTopValues },
	getDomainTopValuesByInterval: { kind: 'item', run: getDomainTopValuesByInterval },
	getLinkClicks: { kind: 'item', run: getLinkClicks },
	getRawClicks: { kind: 'item', run: getRawClicks },
};
