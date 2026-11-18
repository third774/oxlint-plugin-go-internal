// A new declaration whose value is the whole internal module. It publishes every current and
// future export of the module, not one decision.
import * as rows from '../internal/rows';
export const api = rows; // expect: internalModuleExport
export const copy = { ...rows }; // expect: internalModuleExport
export const lazy = () => import('../internal/rows'); // expect: internalModuleExport
