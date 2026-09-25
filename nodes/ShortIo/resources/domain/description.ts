import type { INodeProperties } from 'n8n-workflow';

import { domainLocator } from '../../descriptions/common';

const show = { resource: ['domain'] };

// Shared by Create's Link Type field and Update Settings' Link Type field (domains digest enum).
// Sorted alphabetically by display name.
const LINK_TYPE_OPTIONS = [
	{ name: 'Eight Characters', value: 'eight-char' },
	{ name: 'Four Characters', value: 'four-char' },
	{ name: 'Increment', value: 'increment' },
	{ name: 'Random', value: 'random' },
	{ name: 'Secure', value: 'secure' },
	{ name: 'Ten Characters', value: 'ten-char' },
];

const HTTPS_LEVEL_OPTIONS = [
	{ name: 'HSTS', value: 'hsts' },
	{ name: 'None', value: 'none' },
	{ name: 'Redirect', value: 'redirect' },
];

const ROBOTS_OPTIONS = [
	{ name: 'Allow', value: 'allow' },
	{ name: 'Disallow', value: 'disallow' },
	{ name: 'No Index', value: 'noindex' },
];

// `POST /domains` body (domains digest §3), sorted alphabetically by display name.
const createAdditionalFields: INodeProperties[] = [
	{
		displayName: 'Hide Referer',
		name: 'hideReferer',
		type: 'boolean',
		default: false,
		description: 'Whether to hide the referrer from the destination site for links on this domain',
	},
	{
		displayName: 'Link Type',
		name: 'linkType',
		type: 'options',
		options: LINK_TYPE_OPTIONS,
		default: 'random',
		description: 'The path-generation algorithm used for new links on this domain',
	},
];

// `POST /domains/settings/{domainId}` body (domains digest §4), the 16 user-facing fields after
// dropping `clientStorage` ("for internal use") and the deprecated `purgeExpiredLinks`, sorted
// alphabetically by display name.
const updateFields: INodeProperties[] = [
	{
		displayName: 'AdRoll Integration',
		name: 'integrationAdroll',
		type: 'string',
		default: '',
		description: 'AdRoll pixel ID for all links on this domain. Leave empty to leave it unchanged.',
	},
	{
		displayName: 'Case Sensitive',
		name: 'caseSensitive',
		type: 'boolean',
		default: false,
		description: 'Whether short link paths on this domain are case-sensitive',
	},
	{
		displayName: 'Cloaking',
		name: 'cloaking',
		type: 'boolean',
		default: false,
		description: 'Whether to mask the destination URL in the browser address bar for all links on this domain',
	},
	{
		displayName: 'Enable AI',
		name: 'enableAI',
		type: 'boolean',
		default: false,
		description: 'Whether to enable AI features for all links on this domain',
	},
	{
		displayName: 'Facebook Integration',
		name: 'integrationFB',
		type: 'string',
		default: '',
		description: 'Facebook Pixel ID for all links on this domain. Leave empty to leave it unchanged.',
	},
	{
		displayName: 'Google Analytics Integration',
		name: 'integrationGA',
		type: 'string',
		default: '',
		description: 'Google Analytics ID for all links on this domain. Leave empty to leave it unchanged.',
	},
	{
		displayName: 'Google Tag Manager Integration',
		name: 'integrationGTM',
		type: 'string',
		default: '',
		placeholder: 'G-1234567',
		description:
			'Google Tag Manager or GA4 ID for all links on this domain, matching G-... or GTM-.... Leave empty to leave it unchanged.',
	},
	{
		displayName: 'Hide Referer',
		name: 'hideReferer',
		type: 'boolean',
		default: false,
		description: 'Whether to hide the referrer from the destination site for links on this domain',
	},
	{
		displayName: 'Hide Visitor IP',
		name: 'hideVisitorIp',
		type: 'boolean',
		default: false,
		description: "Whether to avoid storing visitors' IP addresses for links on this domain",
	},
	{
		displayName: 'HTTPS Level',
		name: 'httpsLevel',
		type: 'options',
		options: HTTPS_LEVEL_OPTIONS,
		default: 'redirect',
		description: 'The HTTPS enforcement level for this domain',
	},
	{
		displayName: 'HTTPS Links',
		name: 'httpsLinks',
		type: 'boolean',
		default: true,
		description: 'Whether to generate https short links on this domain',
	},
	{
		displayName: 'Link Type',
		name: 'linkType',
		type: 'options',
		options: LINK_TYPE_OPTIONS,
		default: 'random',
		description: 'The path-generation algorithm used for new links on this domain',
	},
	{
		displayName: 'Redirect 404 URL',
		name: 'redirect404',
		type: 'string',
		default: '',
		description:
			'URL to redirect visitors to for a non-existent short link on this domain. Leave empty to leave it unchanged.',
	},
	{
		displayName: 'Robots',
		name: 'robots',
		type: 'options',
		options: ROBOTS_OPTIONS,
		default: 'allow',
		description: 'The robots.txt behaviour for links on this domain',
	},
	{
		displayName: 'Segment Key',
		name: 'segmentKey',
		type: 'string',
		default: '',
		description: 'Segment integration key for this domain. Leave empty to leave it unchanged.',
	},
	{
		displayName: 'Webhook URL',
		name: 'webhookURL',
		type: 'string',
		default: '',
		description: 'Webhook URL notified of events on this domain. Leave empty to leave it unchanged.',
	},
];

export const domainDescription: INodeProperties[] = [
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
				description: 'Add a new domain to your Short.io account',
				action: 'Create a domain',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a domain',
				action: 'Get a domain',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many domains',
				action: 'Get many domains',
			},
			{
				name: 'Update Settings',
				value: 'updateSettings',
				description: "Update a domain's settings",
				action: 'Update domain settings',
			},
		],
		default: 'getMany',
	},
	{
		displayName: 'Hostname',
		name: 'hostname',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'go.example.com',
		description:
			'The domain hostname to add. This adds a real domain to your Short.io account. Paste a plain hostname; a scheme (https://) or trailing slash is stripped automatically.',
		displayOptions: { show: { ...show, operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...show, operation: ['create'] } },
		options: createAdditionalFields,
	},
	domainLocator({ ...show, operation: ['get', 'updateSettings'] }),
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
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...show, operation: ['updateSettings'] } },
		options: updateFields,
	},
];
