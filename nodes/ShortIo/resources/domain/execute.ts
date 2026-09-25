import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { compact } from '../../../../shared/fields';
import { resolveDomainId } from '../../../../shared/locators';
import { paginateOffset } from '../../../../shared/pagination';
import { shortIoRequest } from '../../../../shared/transport';
import type { OperationEntry } from '../../../../shared/types';

interface DomainFilters {
	pattern?: string;
	teamId?: number;
	noTeamId?: boolean;
}

interface DomainCreateFields {
	hideReferer?: boolean;
	linkType?: string;
}

interface DomainUpdateFields {
	caseSensitive?: boolean;
	cloaking?: boolean;
	enableAI?: boolean;
	hideReferer?: boolean;
	hideVisitorIp?: boolean;
	httpsLevel?: string;
	httpsLinks?: boolean;
	integrationAdroll?: string;
	integrationFB?: string;
	integrationGA?: string;
	integrationGTM?: string;
	linkType?: string;
	redirect404?: string;
	robots?: string;
	segmentKey?: string;
	webhookURL?: string;
}

/** Matches the domains digest's documented `integrationGTM` pattern for `POST /domains/settings/{domainId}`. */
const GTM_ID_RE = /^G(TM)?-\w+$/;

/**
 * Normalizes a user-supplied hostname: trims, strips a leading scheme (e.g. `https://`) and a
 * trailing slash if the user pasted a full URL, then validates it parses as a bare hostname with
 * no path, query string, fragment, or embedded credentials. Reuses `URL`'s own punycode encoding
 * (same technique as `parseShortUrl` in shared/locators.ts) so a unicode hostname (the digest's
 * example is `😀.link`) comes out in its ASCII form.
 */
function normalizeHostname(this: IExecuteFunctions, value: string, i: number): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new NodeOperationError(this.getNode(), 'Hostname must not be empty', { itemIndex: i });
	}
	const withoutScheme = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
	const bare = withoutScheme.replace(/\/+$/, '');

	if (!URL.canParse(`https://${bare}`)) {
		throw new NodeOperationError(this.getNode(), `"${value}" is not a valid hostname`, {
			itemIndex: i,
		});
	}
	const url = new URL(`https://${bare}`);
	if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
		throw new NodeOperationError(
			this.getNode(),
			`"${value}" must be a bare hostname with no path, query string, or credentials`,
			{ itemIndex: i },
		);
	}
	return url.hostname.toLowerCase();
}

async function create(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const hostnameRaw = this.getNodeParameter('hostname', i) as string;
	const fields = this.getNodeParameter('additionalFields', i, {}) as DomainCreateFields;

	const hostname = normalizeHostname.call(this, hostnameRaw, i);
	const body: IDataObject = { hostname, ...compact({ ...fields }) };

	const domain = (await shortIoRequest.call(this, {
		method: 'POST',
		path: '/domains',
		body,
		resource: 'domain',
		itemIndex: i,
	})) as IDataObject;

	return this.helpers.returnJsonArray(domain);
}

async function get(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const domainId = resolveDomainId(domainParam);

	const domain = (await shortIoRequest.call(this, {
		method: 'GET',
		path: `/domains/${domainId}`,
		resource: 'domain',
		itemIndex: i,
	})) as IDataObject;

	return this.helpers.returnJsonArray(domain);
}

async function updateSettings(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const fields = this.getNodeParameter('updateFields', i, {}) as DomainUpdateFields;

	if (Object.keys(fields).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
			itemIndex: i,
		});
	}
	if (fields.integrationGTM && !GTM_ID_RE.test(fields.integrationGTM)) {
		throw new NodeOperationError(
			this.getNode(),
			`"${fields.integrationGTM}" is not a valid Google Tag Manager / GA4 ID (expected a pattern like G-1234567 or GTM-1234567)`,
			{ itemIndex: i },
		);
	}

	const domainId = resolveDomainId(domainParam);
	const body = compact({ ...fields });

	const response = await shortIoRequest.call(this, {
		method: 'POST',
		path: `/domains/settings/${domainId}`,
		body,
		resource: 'domain',
		itemIndex: i,
	});

	const result: IDataObject = { success: true, domainId };
	if (response !== null && typeof response === 'object' && !Array.isArray(response)) {
		const responseBody = response as IDataObject;
		if (Object.keys(responseBody).length > 0) {
			Object.assign(result, responseBody);
		}
	}

	return this.helpers.returnJsonArray(result);
}

async function getMany(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
	const filters = this.getNodeParameter('filters', i, {}) as DomainFilters;
	const pageSize = Math.min(limit ?? 300, 300);

	const domains = await paginateOffset<IDataObject>(
		async (offset, size) =>
			(await shortIoRequest.call(this, {
				method: 'GET',
				path: '/api/domains',
				qs: {
					limit: size,
					offset,
					...(filters.pattern ? { pattern: filters.pattern } : {}),
					...(filters.teamId ? { teamId: filters.teamId } : {}),
					...(filters.noTeamId !== undefined ? { noTeamId: filters.noTeamId } : {}),
				},
				resource: 'domain',
				itemIndex: i,
			})) as IDataObject[],
		limit,
		pageSize,
	);

	return this.helpers.returnJsonArray(domains);
}

export const domainHandlers: Record<string, OperationEntry> = {
	create: { kind: 'item', run: create },
	get: { kind: 'item', run: get },
	getMany: { kind: 'item', run: getMany },
	updateSettings: { kind: 'item', run: updateSettings },
};
