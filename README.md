# oxlint-plugin-go-internal

Private directories for TypeScript and JavaScript. Put code in an `internal/` directory, and only the code next to that directory can import it.

This [oxlint JS plugin](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) applies Go's [`internal` directory rule](https://pkg.go.dev/cmd/go#hdr-Internal_Directories) to imports.

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
- When the rule cannot read a specifier, it reports an error: a `#` specifier that no tsconfig `paths` entry matches, and an `import()` or `require()` whose argument is not a string.

The rule reads every way a file can load a module: `import`, `import type`, `export … from`, `import()`, `import('…')` types, `import x = require('…')`, the global `require()`, and test-runner calls such as `vi.mock('…')`. Type-only imports and tests have no exemption.

Relative and absolute specifiers resolve against the importing file. Other specifiers go through the `paths` of the nearest `tsconfig.json`, with `extends` applied. When a `paths` entry has more than one target, the rule checks every target. Package names (`some-package/internal/x`) are not checked: a package's `exports` field controls what other packages can import.

The rule compares path text only. It does not read the imported files.

## Options

`moduleCallees` lists the calls whose first argument is a module specifier, as `object.method` or a function name. It replaces the default list: `vi.mock`, `vi.doMock`, `vi.unmock`, `vi.doUnmock`, `vi.importActual`, `vi.importMock`, `jest.mock`, `jest.doMock`, `jest.unmock`, `jest.requireActual`, `jest.requireMock`.

```json
{
  "rules": {
    "go-internal/boundaries": ["error", { "moduleCallees": ["vi.mock", "loadFixture"] }]
  }
}
```

A call in this list with a non-string first argument is not reported. Vitest accepts `vi.mock(import('…'))`, and the rule checks that `import()`.

## Errors

| `messageId`               | Cause                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `internalImport`          | A file outside `P/` imports a module under `P/internal/`.                                                |
| `internalDirectoryImport` | A file under `P/` imports `P/internal` itself, or a module named `internal`, not a module inside it.     |
| `internalModuleName`      | The linted file is a module named `internal`.                                                            |
| `internalReExport`        | A file outside `P/internal/` re-exports code from under `P/internal/`.                                   |
| `unknownAlias`            | A `#` specifier matches no `paths` entry of the nearest tsconfig, or no tsconfig is found.               |
| `unresolvedSpecifier`     | An `import()` or `require()` argument is not a string literal or a template literal with no expressions. |

## Known limits

- Specifiers in configuration files that the rule does not lint, such as `vitest.config.mts` aliases, are not checked.
- A `moduleCallees` call that wraps the path in a helper function is not checked.
- Symlinks are not followed. A symlink that points into an `internal/` directory from outside is not detected.
- On a case-insensitive file system, `./Internal/x` can load an `internal/` directory, but the rule treats it as public, as Go's element match does. A project that cares can forbid directories whose names differ from `internal` only in case.
- A bare specifier that TypeScript resolves through `baseUrl` but no `paths` entry is treated as a package name and is not checked.
- oxlint JS plugins are in alpha and do not follow semver. Each release is tested against the `oxlint` version at the lower bound of its peer dependency, and a newer `oxlint` can break the plugin.
