// A new declaration whose value is the whole internal module. The README allows a new export,
// but this one publishes every current and future export of the module, not one decision.
import * as rows from '../internal/rows';
export const api = rows; // expect: internalReExport
export const copy = { ...rows }; // expect: internalReExport
export const lazy = () => import('../internal/rows'); // expect: internalReExport
