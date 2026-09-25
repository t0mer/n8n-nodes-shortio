import type { INodeProperties } from 'n8n-workflow';

import { domainLocator, folderLocator, linkLocator } from '../../descriptions/common';
import { linkAdditionalFields } from '../../descriptions/linkFields';

const show = { resource: ['link'] };

/** Inserts `field` into an alphabetically-sorted (by displayName) list at its sorted position. */
function insertSorted(fields: INodeProperties[], field: INodeProperties): INodeProperties[] {
	const index = fields.findIndex((f) => f.displayName.localeCompare(field.displayName) > 0);
	const result = [...fields];
	if (index === -1) {
		result.push(field);
	} else {
		result.splice(index, 0, field);
	}
	return result;
}

const originalURLField: INodeProperties = {
	displayName: 'Original URL',
	name: 'originalURL',
	type: 'string',
	default: '',
	description: 'The destination URL to redirect visitors to',
};

// `POST /links/{linkId}` (Update) has no top-level `domain`, so unlike Create, Original URL is
// one of the fields inside Update's collection rather than a required parameter of its own.
const updateFields = insertSorted(linkAdditionalFields(true), originalURLField);

export const linkDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a link',
				action: 'Create a link',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a link',
				action: 'Delete a link',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a link',
				action: 'Get a link',
			},
			{
				name: 'Get by Original URL',
				value: 'getByOriginalUrl',
				description: 'Get every link that redirects to a given original URL',
				action: 'Get a link by original URL',
			},
			{
				name: 'Get by Path',
				value: 'getByPath',
				description: 'Get a link by its domain and path',
				action: 'Get a link by path',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many links on a domain',
				action: 'Get many links',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a link',
				action: 'Update a link',
			},
		],
		default: 'create',
	},
	domainLocator({ ...show, operation: ['create'] }),
	{
		displayName: 'Original URL',
		name: 'originalURL',
		type: 'string',
		required: true,
		default: '',
		description: 'The destination URL to redirect visitors to',
		displayOptions: { show: { ...show, operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...show, operation: ['create'] } },
		options: linkAdditionalFields(false),
	},
	linkLocator({ ...show, operation: ['delete', 'get', 'update'] }),
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...show, operation: ['update'] } },
		options: updateFields,
	},
	domainLocator({ ...show, operation: ['getByPath'] }),
	{
		displayName: 'Path',
		name: 'path',
		type: 'string',
		required: true,
		default: '',
		description: "The link's path/slug on the domain. A leading slash is stripped.",
		displayOptions: { show: { ...show, operation: ['getByPath'] } },
	},
	domainLocator({ ...show, operation: ['getByOriginalUrl'] }),
	{
		displayName: 'Original URL',
		name: 'originalURL',
		type: 'string',
		required: true,
		default: '',
		description: 'Find every link on the domain that redirects to this URL',
		displayOptions: { show: { ...show, operation: ['getByOriginalUrl'] } },
	},
	domainLocator({ ...show, operation: ['getMany'] }),
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { ...show, operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 1000 },
		description: 'Max number of results to return',
		displayOptions: { show: { ...show, operation: ['getMany'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { ...show, operation: ['getMany'] } },
		options: [
			{
				displayName: 'After Date',
				name: 'afterDate',
				type: 'dateTime',
				default: '',
				description: 'Only return links created after this date',
			},
			{
				displayName: 'Before Date',
				name: 'beforeDate',
				type: 'dateTime',
				default: '',
				description: 'Only return links created before this date',
			},
			{
				displayName: 'Created At',
				name: 'createdAt',
				type: 'dateTime',
				default: '',
				description: 'Only return links created at this date',
			},
			{
				displayName: 'Date Sort Order',
				name: 'dateSortOrder',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'asc' },
					{ name: 'Descending', value: 'desc' },
				],
				default: 'desc',
				description: 'The order in which to sort links by creation date',
			},
			folderLocator({}, 'folderId', { required: false }),
			{
				displayName: 'ID String',
				name: 'idString',
				type: 'string',
				default: '',
				description: 'Only return the link with this ID string',
			},
		],
	},
];
