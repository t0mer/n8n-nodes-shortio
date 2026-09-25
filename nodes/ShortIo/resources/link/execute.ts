import { NodeOperationError } from 'n8n-workflow';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { buildLinkBody } from '../../../../shared/fields';
import { resolveDomainId, resolveLinkId } from '../../../../shared/locators';
import { shortIoRequest } from '../../../../shared/transport';
import type { ExecContext, OperationEntry } from '../../../../shared/types';

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
	create: { kind: 'item', run: create },
	delete: { kind: 'item', run: del },
	get: { kind: 'item', run: get },
	update: { kind: 'item', run: update },
};
