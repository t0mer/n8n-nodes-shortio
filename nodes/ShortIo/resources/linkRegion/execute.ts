import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { requireOriginalUrl, unwrapOrSuccess } from '../../../../shared/fields';
import { resolveCountryCode, resolveLinkId, resolveRegionCode } from '../../../../shared/locators';
import { shortIoRequest } from '../../../../shared/transport';
import type { OperationEntry } from '../../../../shared/types';

interface RegionTarget {
	country: string;
	region: string;
	originalURL: string;
}

async function create(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const countryParam = this.getNodeParameter('country', i);
	const regionParam = this.getNodeParameter('region', i);
	const originalURL = requireOriginalUrl.call(this, this.getNodeParameter('originalURL', i, ''), i);
	const country = resolveCountryCode.call(this, countryParam, i);
	const region = resolveRegionCode.call(this, regionParam, i);

	const id = await resolveLinkId.call(this, linkParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'POST',
		path: `/link_region/${id}`,
		body: { country, region, originalURL },
		resource: 'link region target',
		itemIndex: i,
	});

	return this.helpers.returnJsonArray(unwrapOrSuccess(response));
}

async function createMany(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const linkParam = this.getNodeParameter('link', i);
	const targetsParam = this.getNodeParameter('targets', i, {}) as { target?: RegionTarget[] };
	const targets = targetsParam.target ?? [];

	if (targets.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one target', { itemIndex: i });
	}

	const body = targets.map((target) => ({
		country: resolveCountryCode.call(this, target.country, i),
		region: resolveRegionCode.call(this, target.region, i),
		originalURL: requireOriginalUrl.call(this, target.originalURL, i),
	}));

	const id = await resolveLinkId.call(this, linkParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'POST',
		path: `/link_region/bulk/${id}`,
		body,
		resource: 'link region target',
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
	const regionParam = this.getNodeParameter('region', i);
	const country = resolveCountryCode.call(this, countryParam, i);
	const region = resolveRegionCode.call(this, regionParam, i);

	const id = await resolveLinkId.call(this, linkParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'DELETE',
		path: `/link_region/${id}/${encodeURIComponent(country)}/${encodeURIComponent(region)}`,
		resource: 'link region target',
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
		path: `/link_region/${id}`,
		resource: 'link region target',
		itemIndex: i,
	});

	const entries = Array.isArray(response) ? (response as IDataObject[]) : [];
	return this.helpers.returnJsonArray(entries);
}

async function getRegionsForCountry(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const countryParam = this.getNodeParameter('country', i);
	const country = resolveCountryCode.call(this, countryParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'GET',
		path: `/link_region/list/${encodeURIComponent(country)}`,
		resource: 'region',
		itemIndex: i,
	});

	const entries = Array.isArray(response) ? (response as IDataObject[]) : [];
	return this.helpers.returnJsonArray(entries);
}

export const linkRegionHandlers: Record<string, OperationEntry> = {
	create: { kind: 'item', run: create },
	createMany: { kind: 'item', run: createMany },
	delete: { kind: 'item', run: del },
	getMany: { kind: 'item', run: getMany },
	getRegionsForCountry: { kind: 'item', run: getRegionsForCountry },
};
