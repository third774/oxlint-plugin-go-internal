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
      valid('src/db/x.ts', "import { x } from 'some-package/internal/x';"),
      valid('src/db/x.ts', "import { x } from '#/teams/store';"),
      valid('src/db/x.spec.ts', "vi.mock('#/teams/store');"),
      valid('src/db/x.spec.ts', "vi.mock(import('#/teams/store'));"),
      valid('src/db/x.ts', 'const req = () => {}; const require = req; require(name);'),
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
        { messageId: 'internalReExport' },
      ]),
      invalid('src/teams/store.ts', "import store from './internal/storage/store'; export default store;", [
        { messageId: 'internalReExport' },
      ]),
      invalid('src/teams/store.ts', "import store = require('./internal/storage/store'); export = store;", [
        { messageId: 'internalReExport' },
      ]),
      invalid('src/teams/store.ts', "export import store = require('./internal/storage/store');", [{ messageId: 'internalReExport' }]),
      invalid('src/teams/index.ts', "export * from './internal/x';", [
        {
          messageId: 'internalReExport',
          data: {
            name: '*',
            specifier: './internal/x',
            boundary: 'src/teams',
          },
        },
      ]),
      invalid('src/teams/index.ts', "export * as x from './internal/x';", [
        {
          messageId: 'internalReExport',
          data: {
            name: 'x',
            specifier: './internal/x',
            boundary: 'src/teams',
          },
        },
      ]),
      invalid('src/teams/internal/storage/index.ts', "export * from './internal/sql';", [
        {
          messageId: 'internalReExport',
          data: {
            name: '*',
            specifier: './internal/sql',
            boundary: 'src/teams/internal/storage',
          },
        },
      ]),
      invalid('src/teams/internal/index.ts', "export * from './storage/internal/sql';", [
        { messageId: 'internalReExport' },
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
          data: { specifier: '#teams/internal/rows', tsconfig: 'tsconfig.json' },
        },
      ]),
      invalid('src/db/x.ts', 'const rows = await import(name);', [{ messageId: 'unresolvedSpecifier' }]),
      invalid('src/db/x.ts', 'const rows = await import(`#/teams/${name}`);', [{ messageId: 'unresolvedSpecifier' }]),
      invalid('src/db/x.ts', 'const rows = require(name);', [{ messageId: 'unresolvedSpecifier' }]),
    ],
  });

  tester.run('tsconfig lookup', boundaries, {
    valid: [
      {
        filename: path.join(fixtures, 'base-url/src/db/x.ts'),
        code: "import { x } from 'teams/internal/x';",
      },
    ],
    invalid: [
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
});
