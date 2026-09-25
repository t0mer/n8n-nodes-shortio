import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';

import { resolveDomainId } from '../../shared/locators';
import { paginateToken } from '../../shared/pagination';
import { shortIoRequest } from '../../shared/transport';
import { selectNewClicks, selectNewLinks } from '../../shared/trigger';
import { domainLocator } from '../ShortIo/descriptions/common';
import { searchDomains } from '../ShortIo/methods/listSearch';

type TriggerEvent = 'newClick' | 'newLink';

/** Links per `GET /api/links` page (the API maximum). */
const LINK_PAGE_SIZE = 150;
/** At most 10 pages of new links per poll. */
const MAX_LINKS_PER_POLL = LINK_PAGE_SIZE * 10;
/** Raw clicks requested per poll. */
const CLICKS_PER_POLL = 100;

interface FetchOptions {
	domainId: number;
	/** High-water mark sent as `afterDate`; omitted when undefined. */
	after?: string;
	/** Most items to fetch. */
	limit: number;
}

async function fetchLinks(this: IPollFunctions, opts: FetchOptions): Promise<IDataObject[]> {
	return paginateToken<IDataObject>(
		async (token, pageSize) => {
			const page = (await shortIoRequest.call(this, {
				method: 'GET',
				path: '/api/links',
				qs: {
					domain_id: opts.domainId,
					dateSortOrder: 'desc',
					limit: pageSize,
					...(opts.after !== undefined ? { afterDate: opts.after } : {}),
					...(token !== undefined ? { pageToken: token } : {}),
				},
				resource: 'domain',
			})) as { links?: IDataObject[]; nextPageToken?: string | null };
			return { items: page?.links ?? [], next: page?.nextPageToken };
		},
		opts.limit,
		LINK_PAGE_SIZE,
	);
}

async function fetchClicks(this: IPollFunctions, opts: FetchOptions): Promise<IDataObject[]> {
	const body: IDataObject = { limit: opts.limit, tz: 'UTC' };
	// The default period is last30; without a mark, ask for all time so the newest click is found.
	if (opts.after !== undefined) body.afterDate = opts.after;
	else body.period = 'total';

	const response = (await shortIoRequest.call(this, {
		method: 'POST',
		host: 'statistics',
		path: `/domain/${opts.domainId}/last_clicks`,
		body,
		resource: 'domain',
	})) as unknown;
	// The spec documents a single object; the API returns a list. Accept both.
	if (Array.isArray(response)) return response as IDataObject[];
	return response && typeof response === 'object' ? [response as IDataObject] : [];
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
							'A short link on the domain was clicked. The first activation only records the newest click.',
					},
					{
						name: 'New Link',
						value: 'newLink',
						description:
							'A link was created on the domain. The first activation only records the newest link.',
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
			const newest = newestOf(await fetch.call(this, { domainId, limit: 1 }));
			return newest ? [[{ json: newest }]] : null;
		}

		const staticData = this.getWorkflowStaticData('node');
		const saved = staticData[event] as IDataObject | undefined;
		const activated = saved !== undefined && saved.domainId === domainId;
		const mark = activated && typeof saved.mark === 'string' ? saved.mark : undefined;

		// On first activation only the newest items matter, so one page is enough.
		const limit =
			event === 'newClick' ? CLICKS_PER_POLL : activated ? MAX_LINKS_PER_POLL : LINK_PAGE_SIZE;
		const items = await fetch.call(this, { domainId, after: mark, limit });

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
