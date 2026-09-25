import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { shortIoRequest } from '../../../shared/transport';

const COUNTRY_RE = /^[A-Z]{2}$/;

interface RegionItem {
	id: string;
	name: string;
}

/**
 * `loadOptionsMethod` for the Region parameter's dropdown (`loadOptionsDependsOn: ['country']`).
 * Returns no options until a valid country is selected, rather than throwing: n8n calls this
 * eagerly while the form is still being filled in, before `country` has a value.
 */
export async function getRegions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const countryParam = this.getCurrentNodeParameter('country');
	const country = String(countryParam ?? '').trim().toUpperCase();
	if (!COUNTRY_RE.test(country)) {
		return [];
	}

	const regions = await shortIoRequest.call(this, {
		method: 'GET',
		path: `/link_region/list/${encodeURIComponent(country)}`,
		resource: 'region',
	});

	if (!Array.isArray(regions)) return [];

	return (regions as RegionItem[])
		.map((region) => ({ name: `${region.name} (${region.id})`, value: region.id }))
		.sort((a, b) => a.name.localeCompare(b.name));
}
