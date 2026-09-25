import type { INodeProperties } from 'n8n-workflow';

import { folderLocator } from './common';

/**
 * The Create/Update "additional fields" collection, built from the `POST /links` body schema
 * (`docs/api/digests/links-core.md`). Display names are sorted alphabetically. When `forUpdate`
 * is true, Folder and Allow Duplicates are left out: `POST /links/{linkId}` has no `folderId`,
 * `allowDuplicates` or `domain` in its body (a link's folder and domain can't be changed via
 * Update, and duplicate-URL dedupe only applies at creation time).
 */
export function linkAdditionalFields(forUpdate: boolean): INodeProperties[] {
	const fields: INodeProperties[] = [
		{
			displayName: 'AdRoll Integration',
			name: 'integrationAdroll',
			type: 'string',
			default: '',
			description: 'AdRoll pixel ID to fire when the link is visited',
		},
	];

	if (!forUpdate) {
		fields.push({
			displayName: 'Allow Duplicates',
			name: 'allowDuplicates',
			type: 'boolean',
			default: false,
			description: 'Whether to create a new link even if one already exists for this URL',
		});
	}

	fields.push(
		{
			displayName: 'Android URL',
			name: 'androidURL',
			type: 'string',
			default: '',
			description: 'Destination URL for visitors on Android',
		},
		{
			displayName: 'Archived',
			name: 'archived',
			type: 'boolean',
			default: false,
			description: 'Whether to create the link already archived',
		},
		{
			displayName: 'Clicks Limit',
			name: 'clicksLimit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 1,
			description: 'Number of clicks after which the link is disabled',
		},
		{
			displayName: 'Cloaking',
			name: 'cloaking',
			type: 'boolean',
			default: false,
			description: 'Whether to mask the destination URL in the browser address bar',
		},
		{
			displayName: 'Created At',
			name: 'createdAt',
			type: 'dateTime',
			default: '',
			description: 'Override the link creation date',
		},
		{
			displayName: 'Expired URL',
			name: 'expiredURL',
			type: 'string',
			default: '',
			description: 'URL to redirect to once the link has expired',
		},
		{
			displayName: 'Expires At',
			name: 'expiresAt',
			type: 'dateTime',
			default: '',
			description: 'Date after which the link redirects to Expired URL instead of the destination',
		},
		{
			displayName: 'Facebook Integration',
			name: 'integrationFB',
			type: 'string',
			default: '',
			description: 'Facebook Pixel ID to fire when the link is visited',
		},
	);

	if (!forUpdate) {
		fields.push(folderLocator({}, 'folderId'));
	}

	fields.push(
		{
			displayName: 'Google Analytics Integration',
			name: 'integrationGA',
			type: 'string',
			default: '',
			description: 'Google Analytics ID to fire when the link is visited',
		},
		{
			displayName: 'Google Tag Manager Integration',
			name: 'integrationGTM',
			type: 'string',
			default: '',
			description: 'Google Tag Manager ID to fire when the link is visited',
		},
		{
			displayName: 'iPhone URL',
			name: 'iphoneURL',
			type: 'string',
			default: '',
			description: 'Destination URL for visitors on iPhone',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Password required to access the link',
		},
		{
			displayName: 'Password Contact',
			name: 'passwordContact',
			type: 'boolean',
			default: false,
			description: 'Whether to show your email on the password page so visitors can request it',
		},
		{
			displayName: 'Path',
			name: 'path',
			type: 'string',
			default: '',
			description: 'The link\'s slug. Leave empty to let Short.io generate one.',
			hint:
				'Same path + same original URL returns the existing link. Same path + a different ' +
				'original URL returns a 409 conflict. No path + an original URL that already has a ' +
				'link returns that existing link, unless Allow Duplicates is on.',
		},
		{
			displayName: 'Redirect Type',
			name: 'redirectType',
			type: 'options',
			options: [
				{ name: '301 - Permanent', value: '301' },
				{ name: '302 - Temporary', value: '302' },
				{ name: '307 - Temporary (Method Preserved)', value: '307' },
				{ name: '308 - Permanent (Method Preserved)', value: '308' },
			],
			default: '302',
			description: 'The HTTP redirect status code to use',
		},
		{
			displayName: 'Skip Query String Merging',
			name: 'skipQS',
			type: 'boolean',
			default: false,
			description: "Whether to skip merging the visitor's query string into the destination URL",
		},
		{
			displayName: 'Split Percent',
			name: 'splitPercent',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 100 },
			default: 50,
			description: 'Percentage of visitors sent to Split URL instead of the destination',
		},
		{
			displayName: 'Split URL',
			name: 'splitURL',
			type: 'string',
			default: '',
			description: 'Alternate destination URL for A/B split testing',
		},
		{
			displayName: 'Tags',
			name: 'tags',
			type: 'string',
			default: '',
			description: 'Comma-separated tags. An expression may return an array instead.',
		},
		{
			displayName: 'Title',
			name: 'title',
			type: 'string',
			default: '',
			description: 'The link title',
		},
		{
			displayName: 'TTL',
			name: 'ttl',
			type: 'dateTime',
			default: '',
			description: 'Time at which the link itself is deleted (not just expired)',
			hint: 'Must be at least 1 week ahead. Deletion may lag by 1-2 hours.',
		},
		{
			displayName: 'UTM Campaign',
			name: 'utmCampaign',
			type: 'string',
			default: '',
			description: 'UTM campaign value (utm_campaign) appended to the destination URL',
		},
		{
			displayName: 'UTM Content',
			name: 'utmContent',
			type: 'string',
			default: '',
			description: 'UTM content value (utm_content) appended to the destination URL',
		},
		{
			displayName: 'UTM Medium',
			name: 'utmMedium',
			type: 'string',
			default: '',
			description: 'UTM medium value (utm_medium) appended to the destination URL',
		},
		{
			displayName: 'UTM Source',
			name: 'utmSource',
			type: 'string',
			default: '',
			description: 'UTM source value (utm_source) appended to the destination URL',
		},
		{
			displayName: 'UTM Term',
			name: 'utmTerm',
			type: 'string',
			default: '',
			description: 'UTM term value (utm_term) appended to the destination URL',
		},
	);

	return fields;
}
