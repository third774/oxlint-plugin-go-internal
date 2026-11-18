// The same aliases, re-exported from a public file of teams/.
export * from '@rows'; // expect: internalReExport
export { store } from '@teams-private/storage/store'; // expect: internalReExport
