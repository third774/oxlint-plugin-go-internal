// CommonJS re-exports. teams/ can require teams/internal, but these make it public.
module.exports = require('../internal/legacy.cjs'); // expect: internalModuleReExport
module.exports.rows = require('../internal/rows'); // expect: internalModuleReExport
exports.store = require('../internal/storage/store'); // expect: internalModuleReExport
Object.assign(module.exports, require('../internal/rows')); // expect: internalModuleReExport
