// TypeScript import aliases that are also exports.
export import rows = require('../internal/rows'); // expect: internalReExport
import * as everything from '../internal/rows';
export import count = everything.rowCount; // expect: internalReExport
