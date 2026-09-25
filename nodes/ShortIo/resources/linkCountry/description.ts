import type { INodeProperties } from 'n8n-workflow';

import { linkLocator } from '../../descriptions/common';
import { COUNTRY_OPTIONS } from '../../countries';

const show = { resource: ['linkCountry'] };

export const linkCountryDescription: INodeProperties[] = [
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
				description: 'Add country-based redirect targeting to a link',
				action: 'Create a link country target',
			},
			{
				name: 'Create Many',
				value: 'createMany',
				description: 'Add several country-based redirect targets to a link',
				action: 'Create many link country targets',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Remove country-based redirect targeting from a link',
				action: 'Delete a link country target',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: "Get a link's country-based redirect targets",
				action: 'Get many link country targets',
			},
		],
		default: 'getMany',
	},
	linkLocator(show),
	{
		displayName: 'Country',
		name: 'country',
		type: 'options',
		options: COUNTRY_OPTIONS,
		default: 'US',
		required: true,
		description: 'The country to target',
		displayOptions: { show: { ...show, operation: ['create', 'delete'] } },
	},
	{
		displayName: 'Original URL',
		name: 'originalURL',
		type: 'string',
		default: '',
		required: true,
		description: 'The destination URL for visitors from that country',
		displayOptions: { show: { ...show, operation: ['create'] } },
	},
	{
		displayName: 'Targets',
		name: 'targets',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Target',
		default: {},
		displayOptions: { show: { ...show, operation: ['createMany'] } },
		options: [
			{
				displayName: 'Target',
				name: 'target',
				values: [
					{
						displayName: 'Country',
						name: 'country',
						type: 'options',
						options: COUNTRY_OPTIONS,
						default: 'US',
						description: 'The country to target',
					},
					{
						displayName: 'Original URL',
						name: 'originalURL',
						type: 'string',
						default: '',
						description: 'The destination URL for visitors from that country',
					},
				],
			},
		],
	},
];
