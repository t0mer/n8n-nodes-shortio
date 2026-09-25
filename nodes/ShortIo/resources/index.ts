import type { HandlerRegistry } from '../../../shared/types';
import { domainDescription } from './domain/description';
import { domainHandlers } from './domain/execute';
import { folderDescription } from './folder/description';
import { folderHandlers } from './folder/execute';
import { linkDescription } from './link/description';
import { archiveMany, createMany, deleteMany, tagMany, unarchiveMany } from './link/bulk';
import { linkHandlers } from './link/execute';
import { generateQrCode, generateQrCodesMany } from './link/qr';
import { linkCountryDescription } from './linkCountry/description';
import { linkCountryHandlers } from './linkCountry/execute';
import { linkOpenGraphDescription } from './linkOpenGraph/description';
import { linkOpenGraphHandlers } from './linkOpenGraph/execute';
import { linkPermissionDescription } from './linkPermission/description';
import { linkPermissionHandlers } from './linkPermission/execute';
import { linkRegionDescription } from './linkRegion/description';
import { linkRegionHandlers } from './linkRegion/execute';

export const HANDLERS: HandlerRegistry = {
	domain: domainHandlers,
	folder: folderHandlers,
	link: {
		...linkHandlers,
		archiveMany: { kind: 'batch', run: archiveMany },
		createMany: { kind: 'batch', run: createMany },
		deleteMany: { kind: 'batch', run: deleteMany },
		generateQrCode: { kind: 'item', run: generateQrCode },
		generateQrCodesMany: { kind: 'batch', run: generateQrCodesMany },
		tagMany: { kind: 'batch', run: tagMany },
		unarchiveMany: { kind: 'batch', run: unarchiveMany },
	},
	linkCountry: linkCountryHandlers,
	linkOpenGraph: linkOpenGraphHandlers,
	linkPermission: linkPermissionHandlers,
	linkRegion: linkRegionHandlers,
};

export {
	domainDescription,
	folderDescription,
	linkDescription,
	linkCountryDescription,
	linkOpenGraphDescription,
	linkPermissionDescription,
	linkRegionDescription,
};
