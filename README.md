# oxlint-plugin-go-internal

Private directories for TypeScript and JavaScript. Put code in an `internal/` directory, and only the code next to that directory can import it.

This [oxlint JS plugin](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) applies Go's [`internal` directory rule](https://pkg.go.dev/cmd/go#hdr-Internal_packages) to imports.

## Why

TypeScript has no "private to this folder" visibility. When a module exports a helper for the file next to it, every file in the project can import that helper. Over time, other features start to use implementation details that were not made for them, and a change in one feature breaks another.

With this plugin, the directory tree shows what is public. You do not need a list of boundaries in your lint configuration, and you do not need naming rules that people must remember.

## The convention

A module under `P/internal/` can be imported only by files under `P/`, the parent of the `internal` directory.

```text
src/
├── teams/
│   ├── index.ts              public: any file can import it
│   ├── layer.ts              can import teams/internal/*
│   ├── __tests__/
│   │   └── store.spec.ts     can import teams/internal/*, because it is under teams/
│   └── internal/
│       ├── rows.ts           private to teams/
│       └── storage/
│           ├── store.ts      private to teams/
│           └── internal/
│               └── sql.ts    private to teams/internal/storage/
└── billing/
    └── invoice.ts            can import teams/index.ts, but not teams/internal/*
```

| File                                  | Import                                   | Result                                               |
| ------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| `src/teams/layer.ts`                  | `./internal/rows`                        | ✅ `layer.ts` is under `teams/`                      |
| `src/teams/internal/storage/store.ts` | `./internal/sql`                         | ✅ `store.ts` is under `teams/internal/storage/`     |
| `src/billing/invoice.ts`              | `../teams/index`                         | ✅ no `internal` in the path                         |
| `src/billing/invoice.ts`              | `../teams/internal/rows`                 | ❌ `invoice.ts` is not under `teams/`                |
| `src/teams/layer.ts`                  | `./internal/storage/internal/sql`        | ❌ `layer.ts` is not under `teams/internal/storage/` |
| `src/teams/index.ts`                  | `export { rows } from './internal/rows'` | ❌ a re-export would make `rows` public to all files |

To make internal code public, declare a new export in a public file, such as `export const rows = internalRows`. Then the public API is a decision in the code, not a side effect of a re-export.

When the lint passes, a reviewer can trust one import line without opening other files:

1. **The path contains an `internal` element:** the importing file is allowed to use that code.
2. **The path contains no `internal` element:** the import reaches no private code, directly or through a re-export.

## Enable it

Install the plugin next to `oxlint`:

```sh
pnpm add --save-dev oxlint oxlint-plugin-go-internal
```

Add the plugin to `.oxlintrc.json`:

```json
{
  "jsPlugins": ["oxlint-plugin-go-internal"],
  "rules": {
    "go-internal/boundaries": "error"
  }
}
```

## The rule

`go-internal/boundaries` is the only rule. It makes these checks together:

- A module under `P/internal/` can be imported only by files under `P/`. When a path has more than one `internal` element, only the last one counts, as in Go. The match is on a whole, case-sensitive path element: `internals`, `_internal` and `Internal` do not count.
- `internal` is always a directory. No module file is named `internal` (`internal.ts`, `internal.d.ts`, `internal.spec.ts`), and no import ends at an `internal` directory (`./internal`, `#/teams/internal`). Import a file inside the directory, such as `./internal/index`.
- A file can re-export internal code only if the file itself is inside that code's `internal/` directory, so a re-export never makes code visible to more files. To publish internal code from a public file, declare a new export, such as `export const store = internalStore` or `export type Row = InternalRow`.
- A new export must not publish a whole internal module, because then every export of that module is public, also the ones that are added later. `export const api = rows` after `import * as rows from './internal/rows'`, `export const api = { ...rows }`, and `export const load = () => import('./internal/rows')` are reported. An object deeper in the export, such as Vue's `components: { ...icons }`, uses the module and is not reported.
- When the rule cannot read a specifier, it reports an error: an alias that matches nothing, and an `import()` or `require()` whose argument is not a string.

The rule reads every way a file can load a module:

- `import`, `import type`, `export … from`, `import()`, `import('…')` types, `import x = require('…')` and `declare module '…'`
- the global `require()`, `require.resolve()`, `module.require()`, and a `require` from `createRequire()`
- `import.meta.resolve()`, `new URL('…', import.meta.url)`, Vite's `import.meta.glob()`, and webpack's `require.context()` and `import.meta.webpackContext()`
- test-runner calls such as `vi.mock('…')`, also when `vi` is imported with another name
- `/// <reference path="…" />`, and in JavaScript files, JSDoc `@import` tags and `import('…')` types

Type-only imports and tests have no exemption. The rule also reads the CommonJS forms of a re-export: `module.exports = require('…')`, `exports.x = require('…')`, `Object.assign(module.exports, require('…'))`, and an object of such values. `exports.x = require('…').x` is a re-export, as `export { x } from '…'` is. A binding of one export, such as `const { x } = require('…')`, is a new export when the file exports it, as `export const x = …` is.

### How specifiers resolve

- Relative specifiers resolve against the importing file.
- A specifier that starts with `/` is a path from the directory of the nearest package.json, as in Vite, unless it already is a path inside that directory. Other absolute specifiers are filesystem paths.
- Other specifiers go through the `paths` of the importing file's tsconfig: the nearest `tsconfig.json` or `jsconfig.json`, with `extends` applied. When that config selects no files, as the root `tsconfig.json` of Vite's templates does, the rule uses the config in its `references` whose `files` and `include` select the file. When a `paths` entry has more than one target, the rule checks every target.
- A `#` specifier that no `paths` entry matches goes through the `imports` field of the nearest package.json, as in Node. The rule checks the target of every condition.
- A specifier that starts with `#`, `@/` or `~/` must match one of these aliases. These are never package names, so an alias that matches nothing is reported, not treated as a package.
- A package specifier with an `internal` element after the package name, such as `some-package/internal/x`, is internal to that package, as in Go. Only the package itself can import it, by its own name. Otherwise, with `baseUrl` set, TypeScript first looks for the specifier under `baseUrl`, so the rule checks it as a path there. The `allowedPackages` option lists packages whose `internal` paths are made for their users.

The rule compares path text only. It does not read the imported files.

## Options

`moduleCallees` lists the calls whose first argument is a module specifier, as `object.method` or a function name. It replaces the default list: `vi.mock`, `vi.doMock`, `vi.unmock`, `vi.doUnmock`, `vi.importActual`, `vi.importMock`, `jest.mock`, `jest.doMock`, `jest.unmock`, `jest.requireActual`, `jest.requireMock`, `jest.unstable_mockModule`, `jest.createMockFromModule`, `jest.setMock`, `mock.module`.

```json
{
  "rules": {
    "go-internal/boundaries": ["error", { "moduleCallees": ["vi.mock", "loadFixture"] }]
  }
}
```

A call in this list with a non-string first argument is not reported. Vitest accepts `vi.mock(import('…'))`, and the rule checks that `import()`.

`aliasPrefixes` lists the prefixes of specifiers that must match a `paths` entry, other than `#`, which always must. It replaces the default list: `@/`, `~/`. Add the prefix of each alias that your project uses, such as `$lib/`.

`allowedPackages` lists the packages whose `internal` paths any file can import, such as `svelte` for `svelte/internal`. The default list is empty.

```json
{
  "rules": {
    "go-internal/boundaries": ["error", { "aliasPrefixes": ["@/", "$lib/"], "allowedPackages": ["svelte"] }]
  }
}
```

## Errors

| `messageId`               | Cause                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `internalImport`          | A file outside `P/` imports a module under `P/internal/`.                                                |
| `internalDirectoryImport` | A file under `P/` imports `P/internal` itself, or a module named `internal`, not a module inside it.     |
| `internalModuleName`      | The linted file is a module named `internal`.                                                            |
| `internalReExport`        | A file outside `P/internal/` re-exports code from under `P/internal/`.                                   |
| `internalModuleExport`    | A file outside `P/internal/` declares an export whose value is a whole module from under `P/internal/`.  |
| `unknownAlias`            | A specifier that starts with `#` or an `aliasPrefixes` prefix matches no `paths` or `imports` entry.     |
| `unresolvedSpecifier`     | An `import()` or `require()` argument is not a string literal or a template literal with no expressions. |

## Known limits

- Specifiers in configuration files that the rule does not lint, such as `vitest.config.mts` aliases, are not checked.
- A `moduleCallees` call that wraps the path in a helper function is not checked.
- An export of a whole internal module through a variable that is exported later, as in `const api = rows; export { api }`, is not reported.
- Symlinks are not followed. A symlink that points into an `internal/` directory from outside is not detected.
- On a case-insensitive file system, `./Internal/x` can load an `internal/` directory, but the rule treats it as public, as Go's element match does. A project that cares can forbid directories whose names differ from `internal` only in case.
- A glob or a `require.context()` directory whose static part has no `internal` element is not checked, also if `**` matches files in an `internal/` directory.
- The root that the rule uses for a specifier that starts with `/` is the nearest package.json directory. A Vite config with another `root` is not read.
- oxlint JS plugins are in alpha and do not follow semver. Each release is tested against the `oxlint` version at the lower bound of its peer dependency, and a newer `oxlint` can break the plugin.
