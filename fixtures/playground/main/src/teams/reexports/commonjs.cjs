// CommonJS re-exports. teams/ can require teams/internal, but these make it public.
module.exports = require('../internal/legacy.cjs'); // expect: internalReExport
module.exports.rows = require('../internal/rows'); // expect: internalReExport
exports.store = require('../internal/storage/store'); // expect: internalReExport
Object.assign(module.exports, require('../internal/rows')); // expect: internalReExport
