import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';

import { resolveDomainId } from '../../shared/locators';
import { shortIoRequest } from '../../shared/transport';
import { clickKey, selectNewClicks, selectNewLinks } from '../../shared/trigger';
import { domainLocator } from '../ShortIo/descriptions/common';
import { searchDomains } from '../ShortIo/methods/listSearch';

type TriggerEvent = 'newClick' | 'newLink';

/** Links per `GET /api/links` page (the API maximum). */
const LINK_PAGE_SIZE = 150;
/** Pages of new links read per poll; a larger backlog is picked up by the next polls. */
const MAX_LINK_PAGES = 10;
/** Raw clicks per `last_clicks` page. */
const CLICK_PAGE_SIZE = 100;
/** Pages of raw clicks read per poll (up to 2,000 clicks). */
const MAX_CLICK_PAGES = 20;

/**
 * `manual`: the newest item only. `first`: one page of the newest items, to set the mark.
 * `poll`: everything after the mark, within the page caps.
 */
type FetchMode = 'first' | 'manual' | 'poll';

interface FetchOptions {
	domainId: number;
	mode: FetchMode;
	/** Saved high-water mark (ISO); only used in `poll` mode. */
	mark?: string;
}

/** Shifts an ISO date by `deltaMs`. Returns the input unchanged when it can't be parsed. */
function shiftIso(value: string, deltaMs: number): string {
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? value : new Date(ms + deltaMs).toISOString();
}

/**
 * Later polls read oldest first from just before the mark (a 1 ms overlap that
 * `selectNewLinks` dedupes), so a backlog larger than the page cap is emitted over the next
 * polls instead of being skipped. Manual mode and first activation read newest first.
 */
async function fetchLinks(this: IPollFunctions, opts: FetchOptions): Promise<IDataObject[]> {
	const poll = opts.mode === 'poll';
	const qs: IDataObject = {
		domain_id: opts.domainId,
		dateSortOrder: poll ? 'asc' : 'desc',
		limit: opts.mode === 'manual' ? 1 : LINK_PAGE_SIZE,
	};
	if (poll && opts.mark !== undefined) qs.afterDate = shiftIso(opts.mark, -1);

	const links: IDataObject[] = [];
	const seenTokens = new Set<string>();
	let token: string | undefined;
	for (let page = 1; ; page++) {
		const response = (await shortIoRequest.call(this, {
			method: 'GET',
			path: '/api/links',
			qs: token !== undefined ? { ...qs, pageToken: token } : qs,
			resource: 'domain',
		})) as { links?: IDataObject[]; nextPageToken?: string | null };
		const items = response?.links ?? [];
		links.push(...items);

		const next = response?.nextPageToken ?? undefined;
		if (!poll || page >= MAX_LINK_PAGES || items.length === 0) break;
		if (next === undefined || seenTokens.has(next)) break;
		seenTokens.add(next);
		token = next;
	}
	return links;
}

async function requestClicks(
	this: IPollFunctions,
	domainId: number,
	body: IDataObject,
): Promise<IDataObject[]> {
	const response = (await shortIoRequest.call(this, {
		method: 'POST',
		host: 'statistics',
		path: `/domain/${domainId}/last_clicks`,
		body,
		resource: 'domain',
	})) as unknown;
	// The spec documents a single object; the API returns a list. Accept both.
	if (Array.isArray(response)) return response as IDataObject[];
	return response && typeof response === 'object' ? [response as IDataObject] : [];
}

/**
 * `last_clicks` ignores `afterDate`/`beforeDate` while `period: 'total'` (Part C evidence); they
 * are honoured, to the millisecond, under any other period. So manual mode and the first
 * activation poll (no mark yet, nothing to page from) still use `period: 'total'`, but a later
 * poll (a mark exists) uses `period: 'custom'` with a wide `startDate` instead, which does honour
 * the cursors. Raw clicks come newest first; later polls page backwards (`beforeDate` = oldest
 * `dt` on the page + 1 ms, an overlap `dt`'s millisecond precision lets `selectNewClicks` dedupe)
 * until a short page, a page reaching the mark, a page with no new clicks, or
 * {@link MAX_CLICK_PAGES}. `afterDate`/`startDate` are the mark minus 1 s. `endDate` is the current
 * time, which as a side effect keeps the request body from repeating between polls — the API
 * caches an identical body for about 60 s, which would otherwise delay a click's emission by up to
 * one poll.
 */
async function fetchClicks(this: IPollFunctions, opts: FetchOptions): Promise<IDataObject[]> {
	if (opts.mode !== 'poll' || opts.mark === undefined) {
		const base: IDataObject = {
			limit: opts.mode === 'manual' ? 1 : CLICK_PAGE_SIZE,
			period: 'total',
			tz: 'UTC',
		};
		return requestClicks.call(this, opts.domainId, base);
	}

	const cursorStart = shiftIso(opts.mark, -1000);
	const base: IDataObject = {
		limit: CLICK_PAGE_SIZE,
		period: 'custom',
		startDate: cursorStart,
		endDate: new Date().toISOString(),
		afterDate: cursorStart,
		tz: 'UTC',
	};

	const markMs = Date.parse(opts.mark);
	const all: IDataObject[] = [];
	const keys = new Set<string>();
	let beforeDate: string | undefined;

	for (let page = 1; ; page++) {
		const list = await requestClicks.call(
			this,
			opts.domainId,
			beforeDate !== undefined ? { ...base, beforeDate } : base,
		);

		let added = 0;
		for (const c of list) {
			const key = clickKey(c);
			if (keys.has(key)) continue;
			keys.add(key);
			all.push(c);
			added++;
		}

		const dates = list.map((c) => Date.parse(String(c.dt ?? ''))).filter(Number.isFinite);
		const oldest = dates.length > 0 ? Math.min(...dates) : NaN;

		if (list.length < CLICK_PAGE_SIZE || added === 0) {
			// A full page that added nothing new but is still newer than the mark most likely means
			// either more than CLICK_PAGE_SIZE clicks landed within the same millisecond (dt's
			// precision can't separate them, so the beforeDate/afterDate cursors can't page past
			// them), or the API silently ignored the cursor for this request. Either way, clicks
			// older than this page may be stuck behind it; the next poll's fresh `endDate` gives it
			// another chance, but warn so a persistent gap is visible (deferred Minor from the Task
			// 22 review).
			if (list.length === CLICK_PAGE_SIZE && !Number.isNaN(oldest) && oldest > markMs) {
				this.logger.warn(
					'Short.io Trigger: New Click got a full page with no new clicks while still newer than the saved mark (likely over 100 clicks in the same millisecond, or the API ignored the cursor); older clicks may be delayed to a later poll',
				);
			}
			break;
		}
		if (Number.isNaN(oldest) || oldest <= markMs) break;

		if (page >= MAX_CLICK_PAGES) {
			this.logger.warn(
				`Short.io Trigger: New Click read ${MAX_CLICK_PAGES} pages (${all.length} clicks) in one poll; older clicks from this burst are skipped`,
			);
			break;
		}
		beforeDate = new Date(oldest + 1).toISOString();
	}
	return all;
}

export class ShortIoTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Short.io Trigger',
		name: 'shortIoTrigger',
		icon: { light: 'file:shortio.svg', dark: 'file:shortio.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"] === "newClick" ? "New Click" : "New Link"}}',
		description: 'Starts the workflow when a Short.io link is created or clicked',
		defaults: { name: 'Short.io Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'shortIoApi', required: true }],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				default: 'newLink',
				options: [
					{
						name: 'New Click',
						value: 'newClick',
						description:
							'A short link on the domain was clicked. The first activation only records the newest click. Reads up to 2,000 clicks per poll; a larger burst between polls emits the newest 2,000 and logs a warning.',
					},
					{
						name: 'New Link',
						value: 'newLink',
						description:
							'A link was created on the domain. The first activation only records the newest link. Links created with a backdated Created At earlier than the last poll are not emitted.',
					},
				],
			},
			domainLocator({}, { description: 'The Short.io domain to watch' }),
		],
	};

	methods = {
		listSearch: { searchDomains },
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event', 'newLink') as TriggerEvent;
		let domainId: number;
		try {
			domainId = resolveDomainId(this.getNodeParameter('domain'));
		} catch (error) {
			throw new NodeOperationError(this.getNode(), (error as Error).message);
		}

		const fetch = event === 'newClick' ? fetchClicks : fetchLinks;
		const newestOf = (items: IDataObject[]): IDataObject | undefined => {
			const { fresh } =
				event === 'newClick'
					? selectNewClicks(items, { keysAtMark: [] })
					: selectNewLinks(items, { idsAtMark: [] });
			return fresh[fresh.length - 1];
		};

		if (this.getMode() === 'manual') {
			const newest = newestOf(await fetch.call(this, { domainId, mode: 'manual' }));
			return newest ? [[{ json: newest }]] : null;
		}

		const staticData = this.getWorkflowStaticData('node');
		const saved = staticData[event] as IDataObject | undefined;
		const activated = saved !== undefined && saved.domainId === domainId;
		const mark = activated && typeof saved.mark === 'string' ? saved.mark : undefined;

		const items = await fetch.call(this, { domainId, mode: activated ? 'poll' : 'first', mark });

		const seen = (key: string): string[] =>
			activated && Array.isArray(saved[key]) ? (saved[key] as string[]) : [];
		const { fresh, next } =
			event === 'newClick'
				? selectNewClicks(items, { mark, keysAtMark: seen('keysAtMark') })
				: selectNewLinks(items, { mark, idsAtMark: seen('idsAtMark') });

		staticData[event] = { domainId, ...next };

		if (!activated || fresh.length === 0) return null;
		return [this.helpers.returnJsonArray(fresh)];
	}
}
