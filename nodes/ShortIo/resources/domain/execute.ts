import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { paginateOffset } from '../../../../shared/pagination';
import { shortIoRequest } from '../../../../shared/transport';
import type { OperationEntry } from '../../../../shared/types';

interface DomainFilters {
	pattern?: string;
	teamId?: number;
	noTeamId?: boolean;
}

async function getMany(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
	const filters = this.getNodeParameter('filters', i, {}) as DomainFilters;
	const pageSize = Math.min(limit ?? 300, 300);

	const domains = await paginateOffset<IDataObject>(
		async (offset, size) =>
			(await shortIoRequest.call(this, {
				method: 'GET',
				path: '/api/domains',
				qs: {
					limit: size,
					offset,
					...(filters.pattern ? { pattern: filters.pattern } : {}),
					...(filters.teamId ? { teamId: filters.teamId } : {}),
					...(filters.noTeamId !== undefined ? { noTeamId: filters.noTeamId } : {}),
				},
				resource: 'domain',
				itemIndex: i,
			})) as IDataObject[],
		limit,
		pageSize,
	);

	return this.helpers.returnJsonArray(domains);
}

export const domainHandlers: Record<string, OperationEntry> = {
	getMany: { kind: 'item', run: getMany },
};
