// TypeScript import aliases that are also exports.
export import rows = require('../internal/rows'); // expect: internalModuleReExport
import * as everything from '../internal/rows';
export import count = everything.rowCount; // expect: internalReExport
