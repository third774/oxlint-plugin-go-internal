// @acme/teams has no `exports` field, so this deep import works.
import { rowCount } from '@acme/teams/src/internal/rows'; // expect: internalImport
export const count = rowCount;
