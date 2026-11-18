// The usual way to call require from an ES module in Node.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const rows = require('../teams/internal/rows'); // expect: internalImport
export const other = createRequire(import.meta.url)('../teams/internal/rows'); // expect: internalImport
export const viaModule = module.require('../teams/internal/rows'); // expect: internalImport
