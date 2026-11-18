// The same aliases, re-exported from a public file of teams/.
export * from '@rows'; // expect: internalModuleReExport
export { store } from '@teams-private/storage/store'; // expect: internalReExport
