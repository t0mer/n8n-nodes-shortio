import type { INodeProperties } from 'n8n-workflow';

import { linkLocator } from '../../descriptions/common';
import { COUNTRY_OPTIONS } from '../../countries';

const show = { resource: ['linkRegion'] };
const showWithLink = { ...show, operation: ['create', 'createMany', 'delete', 'getMany'] };

export const linkRegionDescription: INodeProperties[] = [
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
				description: 'Add region-based redirect targeting to a link',
				action: 'Create a link region target',
			},
			{
				name: 'Create Many',
				value: 'createMany',
				description: 'Add several region-based redirect targets to a link',
				action: 'Create many link region targets',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Remove region-based redirect targeting from a link',
				action: 'Delete a link region target',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: "Get a link's region-based redirect targets",
				action: 'Get many link region targets',
			},
			{
				name: 'Get Regions for Country',
				value: 'getRegionsForCountry',
				description: "Get a country's subdivision codes",
				action: 'Get many regions for a country',
			},
		],
		default: 'getMany',
	},
	linkLocator(showWithLink),
	{
		displayName: 'Country',
		name: 'country',
		type: 'options',
		options: COUNTRY_OPTIONS,
		default: 'US',
		required: true,
		description: 'The country to target',
		displayOptions: { show: { ...show, operation: ['create', 'delete', 'getRegionsForCountry'] } },
	},
	{
		displayName: 'Region Name or ID',
		name: 'region',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getRegions', loadOptionsDependsOn: ['country'] },
		default: '',
		required: true,
		description:
			'The subdivision of the country to target. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		hint: 'Requires the Country field above to be set',
		displayOptions: { show: { ...show, operation: ['create', 'delete'] } },
	},
	{
		displayName: 'Original URL',
		name: 'originalURL',
		type: 'string',
		default: '',
		required: true,
		description: 'The destination URL for visitors from that region',
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
						description: 'The destination URL for visitors from that region',
					},
					{
						displayName: 'Region',
						name: 'region',
						type: 'string',
						default: '',
						description: 'The subdivision of the country to target',
						hint: 'Subdivision code such as CA',
					},
				],
			},
		],
	},
];
