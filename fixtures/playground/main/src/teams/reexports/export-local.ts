// Import first, then re-export the binding.
import { rowCount, dropAllRows } from '../internal/rows';
import * as everything from '../internal/rows';
import type { Row } from '../internal/rows';

export { rowCount }; // expect: internalReExport
export { dropAllRows as reset }; // expect: internalReExport
export { everything }; // expect: internalModuleReExport
export type { Row }; // expect: internalReExport
