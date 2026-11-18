// The same as export-equals.ts, with a type assertion.
import rows = require('../internal/rows');
export = rows as typeof rows; // expect: internalModuleReExport
