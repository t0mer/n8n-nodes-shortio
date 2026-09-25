import type { ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

import { resolveDomainId, type DomainInfo } from '../../../shared/locators';
import { paginateOffset } from '../../../shared/pagination';
import { shortIoRequest } from '../../../shared/transport';

interface LinkFolder {
	id: string | number;
	name: string;
}

interface DomainListItem extends DomainInfo {
	unicodeHostname?: string;
}

/** `searchListMethod` for the Domain resourceLocator's "From List" mode. */
export async function searchDomains(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const domains = await paginateOffset<DomainListItem>(
		async (offset, pageSize) =>
			(await shortIoRequest.call(this, {
				method: 'GET',
				path: '/api/domains',
				qs: {
					limit: pageSize,
					offset,
					...(filter ? { pattern: filter } : {}),
				},
				resource: 'domain',
			})) as DomainListItem[],
		undefined,
		300,
	);

	return {
		results: domains.map((domain) => ({
			name: domain.unicodeHostname ?? domain.hostname,
			value: String(domain.id),
		})),
	};
}

/**
 * `searchListMethod` for the Folder resourceLocator's "From List" mode. Needs the currently
 * selected Domain parameter; returns no results (rather than throwing) until one is set.
 */
export async function searchFolders(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const domainParam = this.getCurrentNodeParameter('domain');
	if (domainParam === undefined || domainParam === null || domainParam === '') {
		return { results: [] };
	}

	let domainId: number;
	try {
		domainId = resolveDomainId(domainParam);
	} catch {
		return { results: [] };
	}

	const response = (await shortIoRequest.call(this, {
		method: 'GET',
		path: `/links/folders/${domainId}`,
		resource: 'folder',
	})) as { linkFolders: LinkFolder[] };

	const folders = response.linkFolders ?? [];
	const filtered = filter
		? folders.filter((folder) => (folder.name ?? '').toLowerCase().includes(filter.toLowerCase()))
		: folders;

	return { results: filtered.map((folder) => ({ name: folder.name, value: folder.id })) };
}
