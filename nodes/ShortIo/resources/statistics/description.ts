import type { INodeProperties } from 'n8n-workflow';

import { domainLocator } from '../../descriptions/common';
import {
	COLUMN_OPTIONS,
	filtersProperty,
	INTERVAL_OPTIONS,
	periodProperties,
	timezoneProperty,
} from '../../descriptions/statistics';

const show = { resource: ['statistics'] };
const op = (...operations: string[]) => ({ ...show, operation: operations });

const DOMAIN_OPS = [
	'clearDomainStatistics',
	'getDomainStatistics',
	'getDomainStatisticsByInterval',
	'getDomainTopValues',
	'getDomainTopValuesByInterval',
	'getLinkClicks',
	'getRawClicks',
];

/** Operations that take period, timezone and include/exclude filters. */
const PERIOD_OPS = [
	'getDomainStatistics',
	'getDomainStatisticsByInterval',
	'getDomainTopValues',
	'getDomainTopValuesByInterval',
	'getRawClicks',
];

const TOP_OPS = ['getDomainTopValues', 'getDomainTopValuesByInterval'];
const LIMIT_OPS = [...TOP_OPS, 'getRawClicks'];
const PREFIX_OPS = ['getDomainTopValues'];

export const statisticsDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Clear Domain Statistics',
				value: 'clearDomainStatistics',
				description: 'Permanently delete all click statistics of a domain',
				action: 'Clear domain statistics',
			},
			{
				name: 'Get Domain Statistics',
				value: 'getDomainStatistics',
				description: 'Get click statistics of a domain',
				action: 'Get domain statistics',
			},
			{
				name: 'Get Domain Statistics by Interval',
				value: 'getDomainStatisticsByInterval',
				description: 'Get click counts of a domain grouped by time interval',
				action: 'Get domain statistics by interval',
			},
			{
				name: 'Get Domain Top Values',
				value: 'getDomainTopValues',
				description: 'Get the top values of a column for a domain, ordered by clicks',
				action: 'Get domain top values',
			},
			{
				name: 'Get Domain Top Values by Interval',
				value: 'getDomainTopValuesByInterval',
				description: 'Get the top values of a column for a domain, per time interval',
				action: 'Get domain top values by interval',
			},
			{
				name: 'Get Link Clicks',
				value: 'getLinkClicks',
				description: 'Get click counts for several links of a domain',
				action: 'Get link clicks',
			},
			{
				name: 'Get Raw Clicks',
				value: 'getRawClicks',
				description: 'Get the latest raw clicks of a domain',
				action: 'Get raw clicks',
			},
		],
		default: 'getDomainStatistics',
	},
	domainLocator(op(...DOMAIN_OPS)),
	{
		displayName: 'Confirm',
		name: 'confirm',
		type: 'boolean',
		default: false,
		required: true,
		description:
			'Whether you understand that this permanently deletes all statistics for the domain',
		displayOptions: { show: op('clearDomainStatistics') },
	},
	{
		displayName: 'Column',
		name: 'column',
		type: 'options',
		options: COLUMN_OPTIONS,
		default: 'path',
		required: true,
		description: 'The column to aggregate clicks by',
		displayOptions: { show: op(...TOP_OPS) },
	},
	{
		displayName: 'Interval',
		name: 'interval',
		type: 'options',
		options: INTERVAL_OPTIONS,
		default: 'day',
		description: 'The time interval to group the top values by',
		displayOptions: { show: op('getDomainTopValuesByInterval') },
	},
	{
		displayName: 'Clicks Chart Interval',
		name: 'clicksChartInterval',
		type: 'options',
		options: INTERVAL_OPTIONS,
		default: 'day',
		description: 'The time interval to group clicks by',
		displayOptions: { show: op('getDomainStatisticsByInterval') },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: op(...LIMIT_OPS) },
	},
	{
		displayName: 'Prefix',
		name: 'prefix',
		type: 'string',
		default: '',
		description: 'Only return values that start with this prefix',
		displayOptions: { show: op(...PREFIX_OPS) },
	},
	{
		displayName: 'Identify Links By',
		name: 'identifyBy',
		type: 'options',
		options: [
			{ name: 'ID', value: 'id' },
			{ name: 'Path', value: 'path' },
		],
		default: 'id',
		description: 'How to identify the links to count clicks for',
		displayOptions: { show: op('getLinkClicks') },
	},
	{
		displayName: 'Link IDs',
		name: 'linkIds',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'lnk_abc123_xyz, lnk_def456_uvw',
		description: 'Comma-separated link IDs',
		displayOptions: { show: { ...op('getLinkClicks'), identifyBy: ['id'] } },
	},
	{
		displayName: 'Links',
		name: 'pathsDates',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Link',
		default: {},
		displayOptions: { show: { ...op('getLinkClicks'), identifyBy: ['path'] } },
		options: [
			{
				displayName: 'Link',
				name: 'link',
				values: [
					{
						displayName: 'Created At',
						name: 'createdAt',
						type: 'dateTime',
						default: '',
						description: 'When the link was created',
					},
					{
						displayName: 'Short URL',
						name: 'path',
						type: 'string',
						default: '',
						placeholder: 'https://short.example/abc123',
						description: 'The full short URL of the link',
					},
				],
			},
		],
	},
	{
		displayName: 'Date Range',
		name: 'dateRange',
		type: 'collection',
		placeholder: 'Add Date',
		default: {},
		description: 'Optional date range to count clicks in (sent as YYYY-MM-DD)',
		displayOptions: { show: op('getLinkClicks') },
		options: [
			{
				displayName: 'End Date',
				name: 'endDate',
				type: 'dateTime',
				default: '',
				description: 'Only count clicks on or before this date',
			},
			{
				displayName: 'Start Date',
				name: 'startDate',
				type: 'dateTime',
				default: '',
				description: 'Only count clicks on or after this date',
			},
		],
	},
	...periodProperties(op(...PERIOD_OPS)),
	timezoneProperty(op(...PERIOD_OPS)),
	filtersProperty(op(...PERIOD_OPS)),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: op('getDomainStatistics') },
		options: [
			{
				displayName: 'Clicks Chart Interval',
				name: 'clicksChartInterval',
				type: 'options',
				options: INTERVAL_OPTIONS,
				default: 'day',
				description: 'The time interval of the click chart data',
			},
			{
				displayName: 'Skip Tops',
				name: 'skipTops',
				type: 'boolean',
				default: true,
				description:
					'Whether to omit the top referrer, social, browser, country, city and OS lists',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: op('getRawClicks') },
		options: [
			{
				displayName: 'After Date',
				name: 'afterDate',
				type: 'dateTime',
				default: '',
				description: 'Only return clicks after this date and time (pagination cursor)',
			},
			{
				displayName: 'Before Date',
				name: 'beforeDate',
				type: 'dateTime',
				default: '',
				description: 'Only return clicks before this date and time (pagination cursor)',
			},
		],
	},
];
