import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { compact } from '../../../../shared/fields';
import { resolveDomainId, resolveFolderId } from '../../../../shared/locators';
import { shortIoRequest } from '../../../../shared/transport';
import type { OperationEntry } from '../../../../shared/types';

interface FolderAdditionalFields {
	backgroundColor?: string;
	color?: string;
	ecLevel?: string;
	expiresAtDays?: number;
	icon?: string;
	integrationAdroll?: string;
	integrationFB?: string;
	integrationGA?: string;
	integrationGTM?: string;
	logoHeight?: number;
	logoUrl?: string;
	logoWidth?: number;
	prefix?: string;
	redirectType?: string;
	utmCampaign?: string;
	utmMedium?: string;
	utmSource?: string;
}

/** The `color`-type UI fields store `#RRGGBB`; the API wants the hex value without the `#` (same treatment as link/qr.ts). */
function stripHash(hex: string | undefined): string | undefined {
	return hex?.replace(/^#/, '');
}

async function create(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const name = (this.getNodeParameter('name', i) as string).trim();
	const fields = this.getNodeParameter('additionalFields', i, {}) as FolderAdditionalFields;

	const domainId = resolveDomainId(domainParam);

	const body: IDataObject = {
		domainId,
		name,
		...compact({
			...fields,
			backgroundColor: stripHash(fields.backgroundColor),
			color: stripHash(fields.color),
			redirectType:
				fields.redirectType !== undefined && fields.redirectType !== ''
					? Number(fields.redirectType)
					: undefined,
		}),
	};

	const folder = (await shortIoRequest.call(this, {
		method: 'POST',
		path: '/links/folders',
		body,
		resource: 'folder',
		itemIndex: i,
	})) as IDataObject;

	return this.helpers.returnJsonArray(folder);
}

async function get(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const folderParam = this.getNodeParameter('folder', i);

	const domainId = resolveDomainId(domainParam);
	const folderId = resolveFolderId.call(this, folderParam, i);

	const folder = (await shortIoRequest.call(this, {
		method: 'GET',
		path: `/links/folders/${domainId}/${encodeURIComponent(folderId)}`,
		resource: 'folder',
		itemIndex: i,
	})) as IDataObject;

	return this.helpers.returnJsonArray(folder);
}

async function getMany(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const domainParam = this.getNodeParameter('domain', i);
	const domainId = resolveDomainId(domainParam);

	const response = await shortIoRequest.call(this, {
		method: 'GET',
		path: `/links/folders/${domainId}`,
		resource: 'folder',
		itemIndex: i,
	});

	// The digest and live probe agree on the `{ linkFolders: [...] }` envelope, but the folder
	// object shape (and thus whether some future response might be a bare array) was never
	// observed with actual entries; accept a bare array defensively too.
	const folders = Array.isArray(response)
		? (response as IDataObject[])
		: ((response as { linkFolders?: IDataObject[] } | undefined)?.linkFolders ?? []);

	return this.helpers.returnJsonArray(folders);
}

export const folderHandlers: Record<string, OperationEntry> = {
	create: { kind: 'item', run: create },
	get: { kind: 'item', run: get },
	getMany: { kind: 'item', run: getMany },
};
