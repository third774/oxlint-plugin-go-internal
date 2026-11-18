// CommonJS and webpack ways to load a module by path.
const path = require.resolve('../teams/internal/rows'); // expect: internalImport
const context = require.context('../teams/internal', true, /\.ts$/); // expect: internalImport
const { rowCount } = require('../teams/internal/rows'); // expect: internalImport
module.exports = { path, context, rowCount };
