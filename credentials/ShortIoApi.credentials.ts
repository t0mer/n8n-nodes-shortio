import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ShortIoApi implements ICredentialType {
	name = 'shortIoApi';

	displayName = 'Short.io API';

	icon: Icon = { light: 'file:shortio.svg', dark: 'file:shortio.dark.svg' };

	documentationUrl = 'https://developers.short.io/docs/creating-an-api-key';

	properties: INodeProperties[] = [
		{
			displayName: 'Secret API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Secret API key from Short.io → Integrations & API. Public keys are not supported.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '={{$credentials.apiKey}}' } },
	};

	test: ICredentialTestRequest = {
		request: { baseURL: 'https://api.short.io', url: '/api/domains', qs: { limit: 1 } },
	};
}
