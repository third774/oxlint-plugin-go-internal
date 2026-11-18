// A JavaScript file with checkJs-style JSDoc types.
/** @import { Row } from '../teams/internal/rows' */ // expect: internalImport

/** @type {import('../teams/internal/rows').Row[]} */ // expect: internalImport
export const rows = [];
