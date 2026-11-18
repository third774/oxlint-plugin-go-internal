// Standard and bundler ways to load a module by path that are not import statements.
export const resolved = import.meta.resolve('../teams/internal/rows'); // expect: internalImport
export const url = new URL('../teams/internal/worker.ts', import.meta.url); // expect: internalImport
export const worker = new Worker(new URL('../teams/internal/worker.ts', import.meta.url), { type: 'module' }); // expect: internalImport
export const modules = import.meta.glob('../teams/internal/*.ts'); // expect: internalImport
