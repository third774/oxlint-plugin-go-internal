---
'oxlint-plugin-go-internal': minor
---

Check more of the ways that a file can load or publish internal code. A project that passed the lint before can get new errors.

- Rewrite the advice in the `internalReExport` message: it now asks which files outside the boundary need the value, and removes the re-export as the default. A re-export of a whole module, such as `export *`, now gets the new `internalModuleReExport` error.
- Report re-exports in TypeScript wrappers, such as `export default store as Store`, `export = rows satisfies Rows` and `export import a = ns.b`.
- Report CommonJS re-exports: `module.exports = require('…')`, `exports.x = require('…')`, `Object.assign(module.exports, require('…'))`, and objects of such values.
- Report, with the new `internalModuleExport` error, a new export whose value is a whole internal module: a namespace import, an object with a spread of one, or a function that only returns `import('…')`.
- Read `jsconfig.json`, and the tsconfig in the `references` of a solution tsconfig, such as the root `tsconfig.json` of Vite's templates.
- Resolve `#` specifiers through the `imports` field of package.json when no `paths` entry matches them.
- Report specifiers that start with `@/` or `~/` and match no `paths` entry as `unknownAlias`. The new `aliasPrefixes` option sets these prefixes. The `unknownAlias` message now names the config files that the rule read.
- Check `import.meta.resolve()`, `new URL('…', import.meta.url)`, `import.meta.glob()`, `import.meta.webpackContext()`, `require.resolve()`, `require.context()`, `module.require()`, `createRequire()`, `declare module '…'`, `/// <reference path="…" />`, and JSDoc `@import` tags and `import('…')` types in JavaScript files.
- Add `jest.unstable_mockModule`, `jest.createMockFromModule`, `jest.setMock` and `mock.module` to the default `moduleCallees`, and check a test-runner call through a renamed import, such as `v.mock(…)` after `import { vi as v } from 'vitest'`.
- Report a package specifier with an `internal` element, such as `some-package/internal/x`, with the new `packageInternalImport` error. The new `allowedPackages` option lists packages whose `internal` paths any file can import. With `baseUrl` set, check such a specifier of another package as a path under `baseUrl`.
- Resolve a specifier that starts with `/` from the directory of the nearest package.json, as Vite does, unless it already is a path inside that directory.
