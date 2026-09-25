import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { unwrapOrSuccess } from '../../../../shared/fields';
import { resolveDomainId, resolveLinkId, resolvePositiveInt } from '../../../../shared/locators';
import { shortIoRequest } from '../../../../shared/transport';
import type { OperationEntry } from '../../../../shared/types';

/**
 * Parses and validates a user id before it's interpolated into the request path. `userId` is a
 * plain `number`-typed parameter, but n8n doesn't enforce that type at runtime when the field is
 * driven by an expression (e.g. mapped from upstream data): a non-numeric string would otherwise
 * reach the URL unvalidated, the same class of bug `resolveDomainId`/`resolveLinkId` guard against
 * for the other two path segments.
 */
function resolveUserId(this: IExecuteFunctions, param: unknown, i: number): number {
	const raw = String(param ?? '').trim();
	return resolvePositiveInt.call(this, raw, 'user ID', i);
}

async function add(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const linkParam = this.getNodeParameter('link', i);
	const userId = resolveUserId.call(this, this.getNodeParameter('userId', i), i);

	const domainId = resolveDomainId(domainParam);
	const id = await resolveLinkId.call(this, linkParam, i);

	const permission = (await shortIoRequest.call(this, {
		method: 'POST',
		path: `/links/permissions/${domainId}/${id}/${userId}`,
		resource: 'link or user',
		itemIndex: i,
	})) as IDataObject;

	return this.helpers.returnJsonArray(permission);
}

async function del(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const linkParam = this.getNodeParameter('link', i);
	const userId = resolveUserId.call(this, this.getNodeParameter('userId', i), i);

	const domainId = resolveDomainId(domainParam);
	const id = await resolveLinkId.call(this, linkParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'DELETE',
		path: `/links/permissions/${domainId}/${id}/${userId}`,
		resource: 'link or user',
		itemIndex: i,
	});

	return this.helpers.returnJsonArray(unwrapOrSuccess(response));
}

async function getMany(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const linkParam = this.getNodeParameter('link', i);

	const domainId = resolveDomainId(domainParam);
	const id = await resolveLinkId.call(this, linkParam, i);

	const response = await shortIoRequest.call(this, {
		method: 'GET',
		path: `/links/permissions/${domainId}/${id}`,
		resource: 'link',
		itemIndex: i,
	});

	const permissions = Array.isArray(response) ? (response as IDataObject[]) : [];
	return this.helpers.returnJsonArray(permissions);
}

export const linkPermissionHandlers: Record<string, OperationEntry> = {
	add: { kind: 'item', run: add },
	delete: { kind: 'item', run: del },
	getMany: { kind: 'item', run: getMany },
};
