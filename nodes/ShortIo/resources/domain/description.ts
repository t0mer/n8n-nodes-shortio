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

// Identical in `POST /domains` (Create) and `POST /domains/settings/{domainId}` (Update Settings);
// shared so the two collections can't drift.
const HIDE_REFERER_FIELD: INodeProperties = {
	displayName: 'Hide Referer',
	name: 'hideReferer',
	type: 'boolean',
	default: false,
	description: 'Whether to hide the referrer from the destination site for links on this domain',
};

// `POST /domains` body (domains digest §3), sorted alphabetically by display name.
const createAdditionalFields: INodeProperties[] = [
	HIDE_REFERER_FIELD,
	{
		displayName: 'Link Type',
		name: 'linkType',
		type: 'options',
		options: LINK_TYPE_OPTIONS,
		default: 'random',
		description: 'The path-generation algorithm used for new links on this domain',
	},
];

// The 7 nullable Update Settings fields (domains digest §4), exposed as an explicit "clear this
// field" multiOptions so the API's null/"" clearing semantics are reachable without ambiguity
// (an empty Update Fields entry means "leave unchanged", never "clear" — see fix round 1).
// Display names match their `updateFields` counterparts exactly; sorted alphabetically.
const CLEAR_FIELDS_OPTIONS = [
	{ name: 'AdRoll Integration', value: 'integrationAdroll' },
	{ name: 'Facebook Integration', value: 'integrationFB' },
	{ name: 'Google Analytics Integration', value: 'integrationGA' },
	{ name: 'Google Tag Manager Integration', value: 'integrationGTM' },
	{ name: 'Not Found Redirect', value: 'redirect404' },
	{ name: 'Segment Key', value: 'segmentKey' },
	{ name: 'Webhook URL', value: 'webhookURL' },
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
	HIDE_REFERER_FIELD,
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
		displayName: 'Not Found Redirect',
		name: 'redirect404',
		type: 'string',
		default: '',
		description:
			'URL to redirect visitors to for a non-existent short link on this domain. Leave empty to leave it unchanged, or select this field in Clear Fields to remove it.',
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
	{
		displayName: 'Clear Fields',
		name: 'clearFields',
		type: 'multiOptions',
		default: [],
		description:
			'Fields to explicitly clear on the domain (sent as null, or as an empty string for Not Found Redirect) instead of leaving them unchanged. A field selected here must not also be set in Update Fields.',
		displayOptions: { show: { ...show, operation: ['updateSettings'] } },
		options: CLEAR_FIELDS_OPTIONS,
	},
];
