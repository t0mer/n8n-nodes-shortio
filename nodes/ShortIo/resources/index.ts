import type { HandlerRegistry } from '../../../shared/types';
import { domainDescription } from './domain/description';
import { domainHandlers } from './domain/execute';
import { linkDescription } from './link/description';
import { archiveMany, createMany, deleteMany, tagMany, unarchiveMany } from './link/bulk';
import { linkHandlers } from './link/execute';

export const HANDLERS: HandlerRegistry = {
	domain: domainHandlers,
	link: {
		...linkHandlers,
		archiveMany: { kind: 'batch', run: archiveMany },
		createMany: { kind: 'batch', run: createMany },
		deleteMany: { kind: 'batch', run: deleteMany },
		tagMany: { kind: 'batch', run: tagMany },
		unarchiveMany: { kind: 'batch', run: unarchiveMany },
	},
};

export { domainDescription, linkDescription };
