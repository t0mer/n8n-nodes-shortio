import type { HandlerRegistry } from '../../../shared/types';
import { domainDescription } from './domain/description';
import { domainHandlers } from './domain/execute';

export const HANDLERS: HandlerRegistry = {
	domain: domainHandlers,
};

export { domainDescription };
