import type { INodeProperties } from 'n8n-workflow';

import { domainLocator, linkLocator } from '../../descriptions/common';

const show = { resource: ['linkPermission'] };

export const linkPermissionDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Add',
				value: 'add',
				description: 'Grant a team member permission to a link',
				action: 'Add a link permission',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: "Remove a team member's permission to a link",
				action: 'Delete a link permission',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: "Get a link's permissions",
				action: 'Get many link permissions',
			},
		],
		default: 'getMany',
	},
	domainLocator(show),
	linkLocator(show),
	{
		displayName: 'User ID',
		name: 'userId',
		type: 'number',
		required: true,
		default: 0,
		description: 'The team member to grant or remove the permission for',
		hint: 'Short.io team member user ID',
		displayOptions: { show: { ...show, operation: ['add', 'delete'] } },
	},
];
