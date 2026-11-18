# oxlint-plugin-go-internal

This package is the oxlint JS plugin behind the `go-internal/boundaries` rule, published to npm. The README describes the rule for its users.

- `tsdown` builds `src/index.ts` into `dist/` for npm. This repository's `.oxlintrc.json` and the CLI test load `src/index.ts` directly. Import local modules with their `.ts` extension and use only erasable TypeScript syntax.
- The plugin is synchronous ESLint-style code.
- The rule uses `createOnce`. Do per-file work in the `Program` visitor, not in `before`, because oxlint does not promise to call `before` for every file.
- Keep path logic in `src/module-path.ts` and `src/checks.ts`, free of AST types, so that the property tests can call it directly.
- JS plugins are alpha and not semver. Keep `@oxlint/plugins` at the same version as `oxlint`, and keep `src/__tests__/cli.spec.ts` running the real CLI.
- `fixtures/` holds tsconfig projects for `RuleTester` cases. The rule does not read imported files, so the fixtures have none.
- `fixtures/playground/` holds projects for trying patterns with the real CLI. Run `node fixtures/playground/run.ts --gaps` to compare the reports with the `// expect:` markers. Lint, format and test runs skip its projects. Its `README.md` describes it.
- For a change that needs a release, add a changeset with `pnpm changeset`. `.changeset/README.md` describes the release process.
- Run `pnpm checks` after changing this package.
