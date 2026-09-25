import type { INodeProperties } from 'n8n-workflow';

import { domainLocator, linkLocator } from '../../descriptions/common';
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
	linkLocator({ ...show, operation: ['get', 'update', 'delete'] }),
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...show, operation: ['update'] } },
		options: updateFields,
	},
];
