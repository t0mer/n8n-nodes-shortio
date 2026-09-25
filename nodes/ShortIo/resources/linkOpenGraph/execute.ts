import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { resolveDomainId, resolveLinkId } from '../../../../shared/locators';
import { shortIoRequest } from '../../../../shared/transport';
import type { OperationEntry } from '../../../../shared/types';

interface OpenGraphProperty {
	key: string;
	value: string;
}

async function get(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const linkParam = this.getNodeParameter('link', i);
	const domainId = resolveDomainId(domainParam);
	const id = await resolveLinkId.call(this, linkParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'GET',
		path: `/links/opengraph/${domainId}/${id}`,
		resource: 'link',
		itemIndex: i,
	});

	if (Array.isArray(response)) {
		const pairs = response as [string, string][];
		return this.helpers.returnJsonArray({ properties: Object.fromEntries(pairs), raw: pairs });
	}

	return this.helpers.returnJsonArray({ properties: {}, raw: response as IDataObject });
}

async function set(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const linkParam = this.getNodeParameter('link', i);
	const propertiesParam = this.getNodeParameter('properties', i, {}) as { property?: OpenGraphProperty[] };
	const properties = propertiesParam.property ?? [];

	if (properties.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Add at least one property to set', {
			itemIndex: i,
		});
	}

	const domainId = resolveDomainId(domainParam);
	const id = await resolveLinkId.call(this, linkParam, i);
	const body = properties.map((property) => [property.key, property.value]);

	const response = await shortIoRequest.call(this, {
		method: 'PUT',
		path: `/links/opengraph/${domainId}/${id}`,
		body,
		resource: 'link',
		itemIndex: i,
	});

	const result: IDataObject = { success: true };
	if (response !== null && typeof response === 'object' && !Array.isArray(response)) {
		const responseBody = response as IDataObject;
		if (Object.keys(responseBody).length > 0) {
			Object.assign(result, responseBody);
		}
	}

	return this.helpers.returnJsonArray(result);
}

export const linkOpenGraphHandlers: Record<string, OperationEntry> = {
	get: { kind: 'item', run: get },
	set: { kind: 'item', run: set },
};
