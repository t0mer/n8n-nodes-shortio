import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { resolveCountryCode, resolveLinkId } from '../../../../shared/locators';
import { shortIoRequest } from '../../../../shared/transport';
import type { OperationEntry } from '../../../../shared/types';

interface CountryTarget {
	country: string;
	originalURL: string;
}

function requireOriginalUrl(this: IExecuteFunctions, value: unknown, i: number): string {
	const raw = String(value ?? '').trim();
	if (!raw) {
		throw new NodeOperationError(this.getNode(), 'Original URL is required', { itemIndex: i });
	}
	return raw;
}

async function create(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const countryParam = this.getNodeParameter('country', i);
	const originalURL = requireOriginalUrl.call(this, this.getNodeParameter('originalURL', i, ''), i);

	const id = await resolveLinkId.call(this, linkParam, i);
	const country = resolveCountryCode.call(this, countryParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'POST',
		path: `/link_country/${id}`,
		body: { country, originalURL },
		resource: 'link country target',
		itemIndex: i,
	});

	const result: IDataObject =
		response !== null &&
		typeof response === 'object' &&
		!Array.isArray(response) &&
		Object.keys(response as object).length > 0
			? (response as IDataObject)
			: { success: true };

	return this.helpers.returnJsonArray(result);
}

async function createMany(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const targetsParam = this.getNodeParameter('targets', i, {}) as { target?: CountryTarget[] };
	const targets = targetsParam.target ?? [];

	if (targets.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one target', { itemIndex: i });
	}

	const id = await resolveLinkId.call(this, linkParam, i);

	const body = targets.map((target) => ({
		country: resolveCountryCode.call(this, target.country, i),
		originalURL: requireOriginalUrl.call(this, target.originalURL, i),
	}));

	const response = await shortIoRequest.call(this, {
		method: 'POST',
		path: `/link_country/bulk/${id}`,
		body,
		resource: 'link country target',
		itemIndex: i,
	});

	const results = Array.isArray(response) ? (response as IDataObject[]) : [];
	return results.length > 0
		? this.helpers.returnJsonArray(results)
		: this.helpers.returnJsonArray({ success: true });
}

async function del(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const countryParam = this.getNodeParameter('country', i);

	const id = await resolveLinkId.call(this, linkParam, i);
	const country = resolveCountryCode.call(this, countryParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'DELETE',
		path: `/link_country/${id}/${encodeURIComponent(country)}`,
		resource: 'link country target',
		itemIndex: i,
	});

	const responseObj: IDataObject =
		response !== null && typeof response === 'object' && !Array.isArray(response)
			? (response as IDataObject)
			: {};

	return this.helpers.returnJsonArray({ success: true, ...responseObj });
}

async function getMany(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const id = await resolveLinkId.call(this, linkParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'GET',
		path: `/link_country/${id}`,
		resource: 'link country target',
		itemIndex: i,
	});

	const entries = Array.isArray(response) ? (response as IDataObject[]) : [];
	return this.helpers.returnJsonArray(entries);
}

export const linkCountryHandlers: Record<string, OperationEntry> = {
	create: { kind: 'item', run: create },
	createMany: { kind: 'item', run: createMany },
	delete: { kind: 'item', run: del },
	getMany: { kind: 'item', run: getMany },
};
