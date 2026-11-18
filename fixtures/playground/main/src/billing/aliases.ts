// `paths` aliases whose specifier has no `internal` element, but whose target does.
import { rowCount } from '@rows'; // expect: internalImport
import { store } from '@teams-private/storage/store'; // expect: internalImport
export const all = [rowCount, store];
