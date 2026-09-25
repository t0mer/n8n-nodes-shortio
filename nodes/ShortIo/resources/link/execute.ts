import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { buildLinkBody, compact, toIsoDate } from '../../../../shared/fields';
import { locatorValue, resolveDomainId, resolveLinkId } from '../../../../shared/locators';
import { paginateToken, paginateTokenFind } from '../../../../shared/pagination';
import { shortIoRequest } from '../../../../shared/transport';
import type { ExecContext, OperationEntry } from '../../../../shared/types';

interface LinkGetManyFilters {
	afterDate?: unknown;
	beforeDate?: unknown;
	createdAt?: unknown;
	dateSortOrder?: string;
	folderId?: unknown;
	idString?: string;
}

async function archive(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const id = await resolveLinkId.call(this, linkParam, i);

	await shortIoRequest.call(this, {
		method: 'POST',
		path: '/links/archive',
		body: { link_id: id },
		resource: 'link',
		itemIndex: i,
	});

	return this.helpers.returnJsonArray({ success: true, idString: id });
}

async function unarchive(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const id = await resolveLinkId.call(this, linkParam, i);

	await shortIoRequest.call(this, {
		method: 'POST',
		path: '/links/unarchive',
		body: { link_id: id },
		resource: 'link',
		itemIndex: i,
	});

	return this.helpers.returnJsonArray({ success: true, idString: id });
}

async function create(
	this: IExecuteFunctions,
	i: number,
	ctx: ExecContext,
): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const originalURL = this.getNodeParameter('originalURL', i) as string;
	const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;

	const domain = await ctx.domains.get(this, resolveDomainId(domainParam));

	const body: IDataObject = {
		domain: domain.hostname,
		originalURL,
		...buildLinkBody(additionalFields),
	};

	const link = (await shortIoRequest.call(this, {
		method: 'POST',
		path: '/links',
		body,
		resource: 'link',
		itemIndex: i,
	})) as IDataObject;

	return this.helpers.returnJsonArray(link);
}

async function get(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const id = await resolveLinkId.call(this, linkParam, i);

	const link = (await shortIoRequest.call(this, {
		method: 'GET',
		path: `/links/${id}`,
		resource: 'link',
		itemIndex: i,
	})) as IDataObject;

	return this.helpers.returnJsonArray(link);
}

async function getByPath(
	this: IExecuteFunctions,
	i: number,
	ctx: ExecContext,
): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const rawPath = this.getNodeParameter('path', i) as string;
	const path = rawPath.replace(/^\/+/, '');

	const domain = await ctx.domains.get(this, resolveDomainId(domainParam));

	const link = (await shortIoRequest.call(this, {
		method: 'GET',
		path: '/links/expand',
		qs: { domain: domain.hostname, path },
		resource: 'link',
		itemIndex: i,
	})) as IDataObject;

	return this.helpers.returnJsonArray(link);
}

async function getByOriginalUrl(
	this: IExecuteFunctions,
	i: number,
	ctx: ExecContext,
): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const originalURL = this.getNodeParameter('originalURL', i) as string;

	const domain = await ctx.domains.get(this, resolveDomainId(domainParam));

	const response = (await shortIoRequest.call(this, {
		method: 'GET',
		path: '/links/multiple-by-url',
		qs: { domain: domain.hostname, originalURL },
		resource: 'link',
		itemIndex: i,
	})) as { links: IDataObject[] };

	return this.helpers.returnJsonArray(response.links ?? []);
}

async function getMany(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
	const filters = this.getNodeParameter('filters', i, {}) as LinkGetManyFilters;

	const domainId = resolveDomainId(domainParam);
	// Short.io's `GET /api/links` ignores the `idString` query parameter, so it's never sent; a
	// match is found by scanning pages client-side instead (see `getMany`'s branch below).
	const idString = filters.idString;
	const filterQs = compact({
		afterDate: toIsoDate(filters.afterDate),
		beforeDate: toIsoDate(filters.beforeDate),
		createdAt: toIsoDate(filters.createdAt),
		dateSortOrder: filters.dateSortOrder,
		folderId: filters.folderId !== undefined ? locatorValue(filters.folderId) : undefined,
	});

	const fetchPage = async (token: string | undefined, pageSize: number) => {
		const response = (await shortIoRequest.call(this, {
			method: 'GET',
			path: '/api/links',
			qs: {
				domain_id: domainId,
				limit: pageSize,
				...(token !== undefined ? { pageToken: token } : {}),
				...filterQs,
			},
			resource: 'link',
			itemIndex: i,
		})) as { links: IDataObject[]; nextPageToken?: string | null };
		return { items: response.links, next: response.nextPageToken };
	};

	const links = idString
		? await paginateTokenFind<IDataObject>(
				fetchPage,
				(link) => link.idString === idString || link.id === idString,
				150,
			)
		: await paginateToken<IDataObject>(fetchPage, limit, 150);

	return this.helpers.returnJsonArray(links);
}

async function update(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
	const body = buildLinkBody(updateFields);

	if (Object.keys(body).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
			itemIndex: i,
		});
	}

	const id = await resolveLinkId.call(this, linkParam, i);

	const link = (await shortIoRequest.call(this, {
		method: 'POST',
		path: `/links/${id}`,
		body,
		resource: 'link',
		itemIndex: i,
	})) as IDataObject;

	return this.helpers.returnJsonArray(link);
}

async function del(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const id = await resolveLinkId.call(this, linkParam, i);

	await shortIoRequest.call(this, {
		method: 'DELETE',
		path: `/links/${id}`,
		resource: 'link',
		itemIndex: i,
	});

	return this.helpers.returnJsonArray({ success: true, idString: id });
}

export const linkHandlers: Record<string, OperationEntry> = {
	archive: { kind: 'item', run: archive },
	create: { kind: 'item', run: create },
	delete: { kind: 'item', run: del },
	get: { kind: 'item', run: get },
	getByOriginalUrl: { kind: 'item', run: getByOriginalUrl },
	getByPath: { kind: 'item', run: getByPath },
	getMany: { kind: 'item', run: getMany },
	unarchive: { kind: 'item', run: unarchive },
	update: { kind: 'item', run: update },
};
