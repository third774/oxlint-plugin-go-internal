// tsconfig.app.json maps `@/*`, and TypeScript and Vite resolve it.
import { rowCount } from '@/teams/internal/rows'; // expect: internalImport
export const count = rowCount;
