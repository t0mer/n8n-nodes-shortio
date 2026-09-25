import { NodeConnectionTypes } from 'n8n-workflow';
import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';

import { DomainCache } from '../../shared/locators';
import type { ExecContext } from '../../shared/types';
import { searchDomains, searchFolders } from './methods/listSearch';
import { runOperations } from './router';
import {
	domainDescription,
	HANDLERS,
	linkDescription,
	linkOpenGraphDescription,
	linkPermissionDescription,
} from './resources';

export class ShortIo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Short.io',
		name: 'shortIo',
		icon: { light: 'file:shortio.svg', dark: 'file:shortio.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Create and manage Short.io branded short links, QR codes, targeting, folders, domains, and statistics',
		defaults: { name: 'Short.io' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'shortIoApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Domain', value: 'domain' },
					{ name: 'Link', value: 'link' },
					{ name: 'Link OpenGraph', value: 'linkOpenGraph' },
					{ name: 'Link Permission', value: 'linkPermission' },
				],
				default: 'domain',
			},
			...domainDescription,
			...linkDescription,
			...linkOpenGraphDescription,
			...linkPermissionDescription,
		],
	};

	methods = {
		listSearch: { searchDomains, searchFolders },
		loadOptions: {},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const ctx: ExecContext = { domains: new DomainCache() };
		return runOperations.call(this, HANDLERS, ctx);
	}
}
