import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

import { LINK_ID_REGEX } from '../../../shared/locators';

/** Domain resourceLocator: pick from the account's domains, or enter a numeric domain id. */
export function domainLocator(
	show: IDisplayOptions['show'],
	opts: { required?: boolean; description?: string } = {},
): INodeProperties {
	return {
		displayName: 'Domain',
		name: 'domain',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: opts.required ?? true,
		description: opts.description ?? 'The Short.io domain to operate on',
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchDomains', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: '123456',
				validation: [
					{
						type: 'regex',
						properties: { regex: '^[1-9][0-9]*$', errorMessage: 'Domain ID is numeric' },
					},
				],
			},
		],
	};
}

/** Link resourceLocator: enter a link id (`lnk_…`/`link_…`) or paste a full short URL. */
export function linkLocator(show: IDisplayOptions['show']): INodeProperties {
	return {
		displayName: 'Link',
		name: 'link',
		type: 'resourceLocator',
		default: { mode: 'id', value: '' },
		required: true,
		description: 'The link to operate on',
		displayOptions: { show },
		modes: [
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'lnk_abc123_xyz',
				validation: [
					{ type: 'regex', properties: { regex: LINK_ID_REGEX, errorMessage: 'Not a valid link ID' } },
				],
			},
			{
				displayName: 'By Short URL',
				name: 'url',
				type: 'string',
				placeholder: 'https://short.example/path',
			},
		],
	};
}

/** Folder resourceLocator: pick from the selected domain's folders, or enter a folder id. */
export function folderLocator(
	show: IDisplayOptions['show'],
	name = 'folder',
	opts: { required?: boolean } = {},
): INodeProperties {
	return {
		displayName: 'Folder',
		name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: opts.required ?? true,
		description: 'The folder to operate on. Requires the Domain field above to be set.',
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchFolders', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
			},
		],
	};
}
