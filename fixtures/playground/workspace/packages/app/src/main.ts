// @acme/teams has no `exports` field, so this deep import works.
import { rowCount } from '@acme/teams/src/internal/rows'; // expect: packageInternalImport
export const count = rowCount;
