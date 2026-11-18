import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RuleTester } from 'oxlint/plugins-dev';
import { describe, it } from 'vitest';

import { boundaries } from '../boundaries.ts';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const fixtures = fileURLToPath(new URL('../../fixtures/', import.meta.url));
const project = path.join(fixtures, 'project');

const tester = new RuleTester({ cwd: project, languageOptions: { sourceType: 'module' } });

const file = (relative: string): string => path.join(project, relative);

const valid = (importer: string, code: string): RuleTester.ValidTestCase => ({
  name: `${importer}: ${code}`,
  filename: file(importer),
  code,
});

const invalid = (importer: string, code: string, errors: RuleTester.InvalidTestCase['errors']): RuleTester.InvalidTestCase => ({
  name: `${importer}: ${code}`,
  filename: file(importer),
  code,
  errors,
});

describe('go-internal/boundaries', () => {
  tester.run('Go internal rule', boundaries, {
    valid: [
      valid('src/teams/layer.ts', "import { store } from '#/teams/internal/storage/store';"),
      valid('src/teams/__tests__/store.spec.ts', "import { store } from '#/teams/internal/storage/store';"),
      valid('src/teams/internal/storage/store.ts', "import { rows } from '#/teams/internal/rows';"),
      valid('src/teams/internal/storage/store.ts', "import { sql } from '#/teams/internal/storage/internal/sql';"),
      valid('src/teams/layer.ts', "import { store } from './internal/storage/store';"),
      valid('src/teams/layer.ts', "import { x } from './internal/index';"),
      valid('src/teams/layer.ts', "import { x } from './internals/x';"),
      valid('src/teams/layer.ts', "import { x } from './_internal/x';"),
      valid('src/teams/layer.ts', "import { x } from './Internal/x';"),
      valid('src/db/x.ts', "import { x } from 'some-package/internals/x';"),
      valid('src/db/x.ts', "import { x } from 'node:internal/x';"),
      valid('src/db/x.ts', "import { x } from '#/teams/store';"),
      valid('src/db/x.spec.ts', "vi.mock('#/teams/store');"),
      valid('src/db/x.spec.ts', "vi.mock(import('#/teams/store'));"),
      valid('src/db/x.ts', 'const req = () => {}; const require = req; require(name);'),
      valid('src/db/x.ts', "require('#/teams/internal/rows'); function require(name) { return name; }"),
      valid('src/db/x.ts', "const requ\\u0069re = (name) => name; require('#/teams/internal/rows');"),
    ],
    invalid: [
      invalid('src/db/__tests__/migration.spec.ts', "import { store } from '#/teams/internal/storage/store';", [
        {
          messageId: 'internalImport',
          data: { specifier: '#/teams/internal/storage/store', boundary: 'src/teams' },
        },
      ]),
      invalid('src/db/x.ts', "import { store } from '../teams/internal/storage/store';", [
        {
          messageId: 'internalImport',
          data: { specifier: '../teams/internal/storage/store', boundary: 'src/teams' },
        },
      ]),
      invalid('test/teams.ts', "import { rows } from '#/teams/internal/rows';", [{ messageId: 'internalImport' }]),
      invalid('src/teams/internal/x.ts', "import { sql } from '#/teams/internal/storage/internal/sql';", [
        {
          messageId: 'internalImport',
          data: {
            specifier: '#/teams/internal/storage/internal/sql',
            boundary: 'src/teams/internal/storage',
          },
        },
      ]),
      invalid('src/teams2/x.ts', "import { x } from '#/teams/internal/x';", [{ messageId: 'internalImport' }]),
      invalid('src/db/x.ts', "import type { T } from '#/teams/internal/rows';", [{ messageId: 'internalImport' }]),
      invalid('src/db/x.ts', "import { type T } from '#/teams/internal/rows';", [{ messageId: 'internalImport' }]),
      invalid('src/db/x.ts', "import '#/teams/internal/rows';", [{ messageId: 'internalImport' }]),
      invalid('src/db/x.ts', "type T = import('#/teams/internal/rows').T;", [{ messageId: 'internalImport' }]),
      invalid('src/db/x.ts', "import rows = require('#/teams/internal/rows');", [{ messageId: 'internalImport' }]),
      invalid('src/db/x.ts', "const rows = await import('#/teams/internal/rows');", [{ messageId: 'internalImport' }]),
      invalid('src/db/x.ts', 'const rows = await import(`#/teams/internal/rows`);', [{ messageId: 'internalImport' }]),
      invalid('src/db/x.ts', "const rows = require('#/teams/internal/rows');", [{ messageId: 'internalImport' }]),
      invalid('src/db/x.ts', "import rows = require('#/teams/internal/rows'); const more = require('#/teams/internal/rows');", [
        { messageId: 'internalImport', column: 22 },
        { messageId: 'internalImport', column: 69 },
      ]),
      invalid('src/db/x.ts', "import raw from '#/teams/internal/rows?raw';", [
        { messageId: 'internalImport', data: { specifier: '#/teams/internal/rows?raw', boundary: 'src/teams' } },
      ]),
      invalid('src/db/x.ts', "import { x } from '#both/x';", [
        { messageId: 'internalImport', data: { specifier: '#both/x', boundary: 'src/teams' } },
      ]),
    ],
  });

  tester.run('module calls', boundaries, {
    valid: [
      {
        ...valid('src/db/x.spec.ts', "vi.mock('#/teams/internal/rows');"),
        options: [{ moduleCallees: ['loadModule'] }],
      },
    ],
    invalid: [
      ...[
        'vi.mock',
        'vi.doMock',
        'vi.unmock',
        'vi.doUnmock',
        'vi.importActual',
        'vi.importMock',
        'jest.mock',
        'jest.doMock',
        'jest.unmock',
        'jest.requireActual',
        'jest.requireMock',
      ].map((callee) => invalid('src/db/x.spec.ts', `${callee}('#/teams/internal/rows');`, [{ messageId: 'internalImport' }])),
      invalid('src/db/x.spec.ts', "import { vi } from 'vitest'; vi.mock(import('#/teams/internal/rows'));", [
        { messageId: 'internalImport' },
      ]),
      {
        ...invalid('src/db/x.spec.ts', "loadModule('#/teams/internal/rows');", [{ messageId: 'internalImport' }]),
        options: [{ moduleCallees: ['loadModule'] }],
      },
    ],
  });

  tester.run('internal is a directory', boundaries, {
    valid: [valid('src/teams/internals.ts', 'export const x = 1;')],
    invalid: [
      invalid('src/teams/layer.ts', "import { x } from './internal';", [
        {
          messageId: 'internalDirectoryImport',
          data: { specifier: './internal', path: 'src/teams/internal' },
        },
      ]),
      invalid('src/teams/layer.ts', "import { x } from './internal/';", [{ messageId: 'internalDirectoryImport' }]),
      invalid('src/teams/layer.ts', "import { x } from '#/teams/internal';", [{ messageId: 'internalDirectoryImport' }]),
      invalid('src/teams/layer.ts', "import { x } from './internal.ts';", [{ messageId: 'internalDirectoryImport' }]),
      invalid('src/db/x.ts', "import { x } from '#/teams/internal';", [{ messageId: 'internalImport' }]),
      ...['internal.ts', 'internal.tsx', 'internal.d.ts', 'internal.spec.ts'].map((name) =>
        invalid(`src/teams/${name}`, 'export const x = 1;', [{ messageId: 'internalModuleName', line: 1, column: 0 }]),
      ),
    ],
  });

  tester.run('re-exports', boundaries, {
    valid: [
      valid('src/teams/internal/index.ts', "export * from './storage/store';"),
      valid('src/teams/internal/index.ts', "export { store } from './storage/store';"),
      valid('src/teams/internal/index.ts', "import { store } from './storage/store'; export { store }; export default store;"),
      valid('src/teams/store.ts', "export { rows } from './rows';"),
      valid('src/teams/store.ts', "import { internalRows } from './internal/rows'; export const rows = internalRows;"),
      valid('src/teams/store.ts', "import type { InternalTeamRow } from './internal/rows'; export type TeamRow = InternalTeamRow;"),
      valid('src/teams/store.ts', 'const rows = 1; export { rows }; export default rows;'),
    ],
    invalid: [
      invalid('src/teams/store.ts', "export { TeamRow } from './internal/storage/store';", [
        {
          messageId: 'internalReExport',
          data: {
            name: 'TeamRow',
            specifier: './internal/storage/store',
            boundary: 'src/teams',
          },
        },
      ]),
      invalid('src/teams/store.ts', "export type { TeamRow } from './internal/storage/store';", [{ messageId: 'internalReExport' }]),
      invalid('src/teams/store.ts', "import { TeamRow } from './internal/storage/store'; export { TeamRow };", [
        { messageId: 'internalReExport' },
      ]),
      invalid('src/teams/store.ts', "import type { TeamRow } from './internal/storage/store'; export type { TeamRow as Row };", [
        { messageId: 'internalReExport' },
      ]),
      invalid('src/teams/store.ts', "import * as store from './internal/storage/store'; export { store };", [
        { messageId: 'internalModuleReExport' },
      ]),
      invalid('src/teams/store.ts', "export { TeamRow }; import { TeamRow } from './internal/storage/store';", [
        { messageId: 'internalReExport', data: { name: 'TeamRow', specifier: './internal/storage/store', boundary: 'src/teams' } },
      ]),
      invalid('src/teams/store.ts', "declare module 'teams' { import { TeamRow } from './internal/storage/store'; export { TeamRow }; }", [
        { messageId: 'internalReExport' },
      ]),
      invalid('src/teams/store.ts', "import store from './internal/storage/store'; export default store;", [
        { messageId: 'internalReExport' },
      ]),
      invalid('src/teams/store.ts', "import store = require('./internal/storage/store'); export = store;", [
        { messageId: 'internalModuleReExport' },
      ]),
      invalid('src/teams/store.ts', "export import store = require('./internal/storage/store');", [
        { messageId: 'internalModuleReExport' },
      ]),
      invalid('src/teams/store.ts', "declare module 'teams' { import * as store from './internal/storage/store'; export { store }; }", [
        { messageId: 'internalModuleReExport' },
      ]),
      invalid('src/teams/index.ts', "export * from './internal/x';", [
        {
          messageId: 'internalModuleReExport',
          data: {
            name: '*',
            specifier: './internal/x',
            boundary: 'src/teams',
          },
        },
      ]),
      invalid('src/teams/index.ts', "export * as x from './internal/x';", [
        {
          messageId: 'internalModuleReExport',
          data: {
            name: 'x',
            specifier: './internal/x',
            boundary: 'src/teams',
          },
        },
      ]),
      invalid('src/teams/internal/storage/index.ts', "export * from './internal/sql';", [
        {
          messageId: 'internalModuleReExport',
          data: {
            name: '*',
            specifier: './internal/sql',
            boundary: 'src/teams/internal/storage',
          },
        },
      ]),
      invalid('src/teams/internal/index.ts', "export * from './storage/internal/sql';", [
        { messageId: 'internalModuleReExport' },
        { messageId: 'internalImport' },
      ]),
      invalid('src/db/index.ts', "export { rows } from '#/teams/internal/rows';", [
        { messageId: 'internalReExport' },
        { messageId: 'internalImport' },
      ]),
    ],
  });

  tester.run('fail closed', boundaries, {
    valid: [],
    invalid: [
      invalid('src/db/x.ts', "import { rows } from '#teams/internal/rows';", [
        {
          messageId: 'unknownAlias',
          data: {
            specifier: '#teams/internal/rows',
            reason: 'no entry in the `paths` of `tsconfig.json` or the `imports` of `package.json` matches it',
            where: '`imports` in package.json, or to `paths` in tsconfig.json',
          },
        },
      ]),
      invalid('src/db/x.ts', "import { rows } from '@/teams/internal/rows';", [
        {
          messageId: 'unknownAlias',
          data: {
            specifier: '@/teams/internal/rows',
            reason: 'no entry in the `paths` of `tsconfig.json` matches it',
            where: '`paths` in tsconfig.json',
          },
        },
      ]),
      invalid('src/db/x.ts', "import { rows } from '~/teams/internal/rows';", [{ messageId: 'unknownAlias' }]),
      invalid('src/db/x.ts', 'const rows = await import(name);', [{ messageId: 'unresolvedSpecifier' }]),
      invalid('src/db/x.ts', 'const rows = await import(`#/teams/${name}`);', [{ messageId: 'unresolvedSpecifier' }]),
      invalid('src/db/x.ts', 'const rows = require(name);', [{ messageId: 'unresolvedSpecifier' }]),
    ],
  });

  tester.run('tsconfig lookup', boundaries, {
    valid: [
      {
        filename: path.join(fixtures, 'base-url/src/teams/x.ts'),
        code: "import { x } from 'src/teams/internal/x'; import { y } from 'base-url/src/teams/internal/y';",
      },
    ],
    invalid: [
      {
        filename: path.join(fixtures, 'base-url/src/db/x.ts'),
        code: "import { x } from 'src/teams/internal/x';",
        errors: [
          {
            messageId: 'internalImport',
            data: { specifier: 'src/teams/internal/x', boundary: '../base-url/src/teams' },
          },
        ],
      },
      {
        filename: path.join(fixtures, 'solution/src/db/x.ts'),
        code: "import { x } from '@/teams/internal/x';",
        errors: [{ messageId: 'internalImport', data: { specifier: '@/teams/internal/x', boundary: '../solution/src/teams' } }],
      },
      {
        filename: path.join(fixtures, 'jsconfig/src/db/x.js'),
        code: "import { x } from '@/teams/internal/x';",
        errors: [{ messageId: 'internalImport', data: { specifier: '@/teams/internal/x', boundary: '../jsconfig/src/teams' } }],
      },
      {
        filename: path.join(fixtures, 'base-url/src/db/x.ts'),
        code: "import { x } from '@app/teams/internal/x';",
        errors: [
          {
            messageId: 'internalImport',
            data: { specifier: '@app/teams/internal/x', boundary: '../base-url/src/teams' },
          },
        ],
      },
      {
        filename: path.join(fixtures, 'extends/src/teams/x.ts'),
        code: "import { x } from '#/teams/internal/x';",
        errors: [
          {
            messageId: 'internalImport',
            data: { specifier: '#/teams/internal/x', boundary: 'src/teams' },
          },
        ],
      },
    ],
  });

  tester.run('TypeScript expressions around a re-export', boundaries, {
    valid: [valid('src/teams/store.ts', "import { store } from './internal/storage/store'; export const s = store as typeof store;")],
    invalid: [
      ...[
        'export default store as typeof store;',
        'export default store satisfies object;',
        'export default store!;',
        'export default (store as typeof store);',
        'export = store as typeof store;',
      ].map((code) =>
        invalid('src/teams/store.ts', `import store from './internal/storage/store'; ${code}`, [
          { messageId: 'internalReExport', data: { name: 'store', specifier: './internal/storage/store', boundary: 'src/teams' } },
        ]),
      ),
      invalid('src/teams/store.ts', "import * as store from './internal/storage/store'; export import rows = store.rows;", [
        { messageId: 'internalReExport', data: { name: 'rows', specifier: './internal/storage/store', boundary: 'src/teams' } },
      ]),
      invalid('src/teams/store.ts', "import * as store from './internal/storage/store'; import rows = store.rows; export { rows };", [
        { messageId: 'internalReExport', data: { name: 'rows', specifier: './internal/storage/store', boundary: 'src/teams' } },
      ]),
      invalid(
        'src/teams/store.ts',
        "declare module 'teams' { import * as store from './internal/storage/store'; import rows = store.rows; export { rows }; }",
        [{ messageId: 'internalReExport' }],
      ),
    ],
  });

  tester.run('exports of a whole module', boundaries, {
    valid: [
      valid('src/teams/store.ts', "import { rows } from './internal/rows'; export const all = rows; export const copy = { rows };"),
      valid('src/teams/store.ts', "import * as rows from './internal/rows'; export const count = rows.count; const all = rows;"),
      valid(
        'src/teams/store.ts',
        "export const load = () => import('./rows'); export const page = { load: () => import('./internal/page') };",
      ),
      valid('src/teams/internal/index.ts', "import * as store from './storage/store'; export const all = store;"),
      valid(
        'src/teams/store.ts',
        "import * as rows from './internal/rows'; export const all = { rows }; export default { name: 'C', parts: { ...rows } };",
      ),
    ],
    invalid: [
      ...[
        ['export const all = rows;', 'all'],
        ['export const all = { ...rows };', 'all'],
        ['export = { ...rows };', 'export ='],
      ].map(([code = '', name]) =>
        invalid('src/teams/store.ts', `import * as rows from './internal/rows'; ${code}`, [
          { messageId: 'internalModuleExport', data: { name, specifier: './internal/rows', boundary: 'src/teams' } },
        ]),
      ),
      invalid('src/teams/store.ts', "import rows = require('./internal/rows'); export const all = rows;", [
        { messageId: 'internalModuleExport' },
      ]),
      ...[
        "export const load = () => import('./internal/rows');",
        "export const load = async () => await import('./internal/rows');",
        "export function load() { return import('./internal/rows'); }",
        "export const rows = import('./internal/rows');",
        "export default () => import('./internal/rows');",
      ].map((code) => invalid('src/teams/store.ts', code, [{ messageId: 'internalModuleExport' }])),
      invalid('src/db/x.ts', "export const load = () => import('#/teams/internal/rows');", [{ messageId: 'internalImport' }]),
    ],
  });

  tester.run('CommonJS re-exports', boundaries, {
    valid: [
      valid('src/teams/store.cjs', "const { rows } = require('./internal/rows'); exports.rows = rows; module.exports.all = { rows };"),
      valid('src/teams/store.cjs', "const rows = require('./internal/rows'); exports.count = rows.count;"),
      valid('src/teams/store.cjs', "module.exports = require('./rows'); exports.x = require('./internal/rows')();"),
      valid('src/teams/store.cjs', "function load(require) { module.exports = require('./internal/rows'); }"),
      valid('src/teams/internal/index.cjs', "module.exports = require('./storage/store');"),
      valid('src/teams/store.cjs', "module.exports = require('./internal/make')('./internal/rows');"),
      valid(
        'src/teams/store.cjs',
        "exports.y = require('./internal/f').create('./internal/rows'); const x = require('./internal/make')('./internal/rows'); exports.x = x;",
      ),
    ],
    invalid: [
      invalid('src/teams/store.cjs', "exports.count = require('./internal/rows').count;", [
        { messageId: 'internalReExport', data: { name: 'count', specifier: './internal/rows', boundary: 'src/teams' } },
      ]),
      ...[
        "module.exports = require('./internal/rows');",
        "module.exports.rows = require('./internal/rows');",
        "exports.rows = require('./internal/rows');",
        "exports['rows'] = require('./internal/rows');",
        "module.exports = { rows: require('./internal/rows') };",
        "module.exports = { ...require('./internal/rows') };",
        "Object.assign(module.exports, require('./internal/rows'));",
        "Object.assign(exports, { rows: require('./internal/rows') });",
        "const rows = require('./internal/rows'); module.exports = { rows };",
        "const rows = require('./internal/rows'); exports.all = rows;",
      ].map((code) =>
        invalid('src/teams/store.cjs', code, [
          { messageId: 'internalModuleReExport', data: { specifier: './internal/rows', boundary: 'src/teams' } },
        ]),
      ),
      invalid(
        'src/teams/store.ts',
        "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); module.exports = load('./internal/rows');",
        [{ messageId: 'internalModuleReExport' }],
      ),
      invalid('src/db/x.cjs', "module.exports = require('#/teams/internal/rows');", [
        { messageId: 'internalModuleReExport' },
        { messageId: 'internalImport' },
      ]),
    ],
  });

  tester.run('other ways to load a module', boundaries, {
    valid: [
      valid(
        'src/teams/x.ts',
        "const rows = import.meta.glob('./internal/*.ts'); const url = new URL('./internal/worker.ts', import.meta.url);",
      ),
      valid('src/teams/x.cjs', "const files = require.context('./internal', true); const file = require.resolve('./internal/rows');"),
      valid('src/db/x.ts', "const modules = import.meta.glob(['./*.ts', '!../teams/internal/*.ts']);"),
      valid('src/db/x.ts', "const url = new URL('../teams/internal/rows', base);"),
      valid('src/db/x.ts', "function f(require) { require.resolve('#/teams/internal/rows'); }"),
      valid('src/db/x.ts', "const load = make(import.meta.url); load('#/teams/internal/rows');"),
    ],
    invalid: [
      ...[
        "import.meta.resolve('#/teams/internal/rows');",
        "new URL('#/teams/internal/worker.ts', import.meta.url);",
        "new Worker(new URL('../teams/internal/worker.ts', import.meta.url));",
        "import.meta.glob(['./*.ts', '../teams/internal/**/*.ts']);",
        "import.meta.glob('../teams/internal/{a,b}.ts');",
        "import.meta.globEager('../teams/internal/*.ts');",
        "import.meta.webpackContext('../teams/internal');",
        "require.resolve('#/teams/internal/rows');",
        "require.context('../teams/internal', true, /\\.ts$/);",
        "module.require('#/teams/internal/rows');",
        "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); require('#/teams/internal/rows');",
        "import { createRequire as make } from 'node:module'; const load = make(import.meta.url); load('#/teams/internal/rows');",
        "import module from 'node:module'; const load = module.createRequire(import.meta.url); load.resolve('#/teams/internal/rows');",
        "import { createRequire } from 'node:module'; createRequire(import.meta.url)('#/teams/internal/rows');",
        "import { createRequire } from 'node:module'; function load() { const require = createRequire(import.meta.url); return require('#/teams/internal/rows'); }",
      ].map((code) => invalid('src/db/x.ts', code, [{ messageId: 'internalImport' }])),
      invalid('src/db/x.ts', "import.meta.glob('../teams/internal/*.ts');", [
        { messageId: 'internalImport', data: { specifier: '../teams/internal/*.ts', boundary: 'src/teams' } },
      ]),
      invalid('src/db/x.ts', "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load(name);", [
        { messageId: 'unresolvedSpecifier' },
      ]),
    ],
  });

  tester.run('declarations of modules', boundaries, {
    valid: [
      valid('src/teams/x.ts', "export {}; declare module './internal/rows' { interface Row { id: string } }"),
      valid('src/db/x.ts', "declare module '#unknown' { export const x: number; }"),
      valid('src/db/x.ts', "declare module 'some-package' { export const x: number; }"),
    ],
    invalid: [
      invalid('src/db/x.ts', "export {}; declare module '../teams/internal/rows' { interface Row { id: string } }", [
        { messageId: 'internalImport', data: { specifier: '../teams/internal/rows', boundary: 'src/teams' } },
      ]),
      invalid('src/db/x.ts', "export {}; declare module '#/teams/internal/rows' { interface Row { id: string } }", [
        { messageId: 'internalImport' },
      ]),
    ],
  });

  tester.run('comments', boundaries, {
    valid: [
      valid('src/teams/x.ts', '/// <reference path="internal/types.d.ts" />\nexport {};'),
      valid('src/db/x.ts', 'export {};\n/// <reference path="../teams/internal/types.d.ts" />'),
      valid('src/db/x.ts', "/** @import { Row } from '../teams/internal/rows' */\nexport {};"),
      valid('src/db/x.js', "// @import { Row } from '../teams/internal/rows'\nexport {};"),
    ],
    invalid: [
      invalid('src/db/x.ts', '/// <reference path="../teams/internal/types.d.ts" />\nexport {};', [
        {
          messageId: 'internalImport',
          data: { specifier: '../teams/internal/types.d.ts', boundary: 'src/teams' },
          line: 1,
          column: 21,
          endColumn: 49,
        },
      ]),
      invalid('src/db/x.js', "/**\n * @import { Row } from '../teams/internal/rows'\n */\nexport {};", [
        { messageId: 'internalImport', line: 2, column: 25 },
      ]),
      invalid('src/db/x.js', "/** @type {import('#/teams/internal/rows').Row[]} */\nexport const rows = [];", [
        { messageId: 'internalImport', data: { specifier: '#/teams/internal/rows', boundary: 'src/teams' } },
      ]),
    ],
  });

  tester.run('package specifiers', boundaries, {
    valid: [
      valid('src/teams/x.ts', "import { x } from 'project/src/teams/internal/x';"),
      valid('src/db/x.ts', "import { x } from '@scope/package/src/x';"),
    ],
    invalid: [
      invalid('src/db/x.ts', "import { x } from 'some-package/internal/x';", [
        { messageId: 'packageInternalImport', data: { specifier: 'some-package/internal/x', package: 'some-package' } },
      ]),
      invalid('src/db/x.ts', "import { x } from '@scope/package/src/internal/x';", [
        { messageId: 'packageInternalImport', data: { specifier: '@scope/package/src/internal/x', package: '@scope/package' } },
      ]),
      invalid('src/db/x.ts', "import { x } from 'some-package/internal';", [
        { messageId: 'packageInternalImport', data: { specifier: 'some-package/internal', package: 'some-package' } },
      ]),
      invalid('src/db/x.ts', "import { x } from 'project/src/teams/internal/x';", [
        { messageId: 'internalImport', data: { specifier: 'project/src/teams/internal/x', boundary: 'src/teams' } },
      ]),
    ],
  });

  tester.run('paths from the package root', boundaries, {
    valid: [
      valid('src/teams/x.ts', "import { x } from '/src/teams/internal/x';"),
      valid('src/teams/x.ts', `import { x } from '${path.join(project, 'src/teams/internal/x').replaceAll('\\', '/')}';`),
    ],
    invalid: [
      invalid('src/db/x.ts', "import { x } from '/src/teams/internal/x';", [
        { messageId: 'internalImport', data: { specifier: '/src/teams/internal/x', boundary: 'src/teams' } },
      ]),
      invalid('src/teams/x.ts', "export * from '/src/teams/internal/x';", [{ messageId: 'internalModuleReExport' }]),
    ],
  });

  tester.run('package.json imports', boundaries, {
    valid: [
      { filename: path.join(fixtures, 'package-imports/src/teams/x.ts'), code: "import { x } from '#/teams/internal/x.ts';" },
      { filename: path.join(fixtures, 'package-imports/src/db/x.ts'), code: "import { x } from '#/teams/index.ts'; import y from '#dep';" },
    ],
    invalid: [
      {
        filename: path.join(fixtures, 'package-imports/src/db/x.ts'),
        code: "import { x } from '#/teams/internal/x.ts';",
        errors: [{ messageId: 'internalImport', data: { specifier: '#/teams/internal/x.ts', boundary: '../package-imports/src/teams' } }],
      },
      {
        filename: path.join(fixtures, 'package-imports/src/db/x.ts'),
        code: "import { x } from '#conditions';",
        errors: [{ messageId: 'internalImport' }],
      },
      {
        filename: path.join(fixtures, 'package-imports/src/db/x.ts'),
        code: "import { x } from '#missing';",
        errors: [
          {
            messageId: 'unknownAlias',
            data: {
              specifier: '#missing',
              reason:
                'no entry in the `paths` of `../package-imports/tsconfig.json` or the `imports` of `../package-imports/package.json` matches it',
              where: '`imports` in package.json, or to `paths` in tsconfig.json',
            },
          },
        ],
      },
    ],
  });

  tester.run('options', boundaries, {
    valid: [
      { ...valid('src/db/x.ts', "import { x } from '@/teams/x';"), options: [{ aliasPrefixes: ['$lib/'] }] },
      { ...valid('src/db/x.ts', "import { x } from 'svelte/internal';"), options: [{ allowedPackages: ['svelte'] }] },
      ...['jest.unstable_mockModule', 'jest.createMockFromModule', 'jest.setMock', 'mock.module'].map((callee) => ({
        ...valid('src/db/x.spec.ts', `${callee}('#/teams/internal/rows');`),
        options: [{ moduleCallees: ['vi.mock'] }],
      })),
    ],
    invalid: [
      {
        ...invalid('src/db/x.ts', "import { x } from '$lib/x';", [{ messageId: 'unknownAlias' }]),
        options: [{ aliasPrefixes: ['$lib/'] }],
      },
      ...['jest.unstable_mockModule', 'jest.createMockFromModule', 'jest.setMock', 'mock.module'].map((callee) =>
        invalid('src/db/x.spec.ts', `${callee}('#/teams/internal/rows', () => ({}));`, [{ messageId: 'internalImport' }]),
      ),
      invalid('src/db/x.spec.ts', "import { vi as v } from 'vitest'; v.mock('#/teams/internal/rows');", [{ messageId: 'internalImport' }]),
      invalid('src/db/x.spec.ts', "import { mock as m } from 'node:test'; m.module('#/teams/internal/rows');", [
        { messageId: 'internalImport' },
      ]),
    ],
  });
});
