import type { INodeProperties } from 'n8n-workflow';

import { domainLocator, folderLocator } from '../../descriptions/common';

const show = { resource: ['folder'] };

const REDIRECT_TYPE_OPTIONS = [
	{ name: '301 - Permanent', value: '301' },
	{ name: '302 - Temporary', value: '302' },
	{ name: '307 - Temporary (Method Preserved)', value: '307' },
	{ name: '308 - Permanent (Method Preserved)', value: '308' },
];

// From the subresources digest's `POST /links/folders` body schema, sorted alphabetically by
// display name (the create UI names differ from the Link resource's longer integration names,
// per the task 18/19 brief).
const additionalFields: INodeProperties[] = [
	{
		displayName: 'AdRoll Integration',
		name: 'integrationAdroll',
		type: 'string',
		default: '',
		description: 'AdRoll pixel ID for links created in this folder',
	},
	{
		displayName: 'Background Color',
		name: 'backgroundColor',
		type: 'color',
		default: '#FFFFFF',
		description: "The folder QR code's background color. Sent to Short.io as a hex value without the leading #.",
	},
	{
		displayName: 'Color',
		name: 'color',
		type: 'color',
		default: '#000000',
		description: "The folder QR code's foreground color. Sent to Short.io as a hex value without the leading #.",
	},
	{
		displayName: 'EC Level',
		name: 'ecLevel',
		type: 'string',
		default: '',
		description: "The folder QR code's error-correction level",
		hint: 'Short.io does not document an enum for this field; common QR error-correction levels are L, M, Q, and H',
	},
	{
		displayName: 'Expires At Days',
		name: 'expiresAtDays',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		description: 'Default number of days after which links created in this folder expire',
	},
	{
		displayName: 'Facebook Integration',
		name: 'integrationFB',
		type: 'string',
		default: '',
		description: 'Facebook Pixel ID for links created in this folder',
	},
	{
		displayName: 'GA Integration',
		name: 'integrationGA',
		type: 'string',
		default: '',
		description: 'Google Analytics ID for links created in this folder',
	},
	{
		displayName: 'GTM Integration',
		name: 'integrationGTM',
		type: 'string',
		default: '',
		description: 'Google Tag Manager ID for links created in this folder',
	},
	{
		displayName: 'Icon',
		name: 'icon',
		type: 'string',
		default: '',
		description: 'Icon for the folder',
	},
	{
		displayName: 'Logo Height',
		name: 'logoHeight',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 1,
		description: "The QR code logo's height, in pixels",
	},
	{
		displayName: 'Logo URL',
		name: 'logoUrl',
		type: 'string',
		default: '',
		description: "The QR code logo's image URL",
	},
	{
		displayName: 'Logo Width',
		name: 'logoWidth',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 1,
		description: "The QR code logo's width, in pixels",
	},
	{
		displayName: 'Prefix',
		name: 'prefix',
		type: 'string',
		default: '',
		description: 'Path prefix applied to links created in this folder',
	},
	{
		displayName: 'Redirect Type',
		name: 'redirectType',
		type: 'options',
		options: REDIRECT_TYPE_OPTIONS,
		default: '302',
		description: 'Default HTTP redirect status code for links created in this folder',
	},
	{
		displayName: 'UTM Campaign',
		name: 'utmCampaign',
		type: 'string',
		default: '',
		description: 'UTM campaign value (utm_campaign) for links created in this folder',
	},
	{
		displayName: 'UTM Medium',
		name: 'utmMedium',
		type: 'string',
		default: '',
		description: 'UTM medium value (utm_medium) for links created in this folder',
	},
	{
		displayName: 'UTM Source',
		name: 'utmSource',
		type: 'string',
		default: '',
		description: 'UTM source value (utm_source) for links created in this folder',
	},
];

export const folderDescription: INodeProperties[] = [
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
				description: 'Create a folder',
				action: 'Create a folder',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a folder',
				action: 'Get a folder',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many folders',
				action: 'Get many folders',
			},
		],
		default: 'getMany',
	},
	domainLocator(show),
	folderLocator({ ...show, operation: ['get'] }),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		description: 'The folder name',
		displayOptions: { show: { ...show, operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...show, operation: ['create'] } },
		options: additionalFields,
	},
];
