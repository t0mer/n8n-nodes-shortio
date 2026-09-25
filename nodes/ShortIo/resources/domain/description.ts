import type { INodeProperties } from 'n8n-workflow';

const show = { resource: ['domain'] };

export const domainDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many domains',
				action: 'Get many domains',
			},
		],
		default: 'getMany',
	},
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
				displayName: 'Pattern',
				name: 'pattern',
				type: 'string',
				default: '',
				description: 'Filter domains by hostname pattern',
			},
			{
				displayName: 'Team ID',
				name: 'teamId',
				type: 'number',
				default: 0,
				description: 'Filter domains by team',
			},
			{
				displayName: 'Without Team',
				name: 'noTeamId',
				type: 'boolean',
				default: false,
				description: 'Whether to only return domains that belong to no team',
			},
		],
	},
];
