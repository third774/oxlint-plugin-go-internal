# oxlint-plugin-go-internal

This package is the oxlint JS plugin behind the `go-internal/boundaries` rule, published to npm. The README describes the rule for its users.

- `tsdown` builds `src/index.ts` into `dist/` for npm. This repository's `.oxlintrc.json` and the CLI test load `src/index.ts` directly. Import local modules with their `.ts` extension and use only erasable TypeScript syntax.
- The plugin is synchronous ESLint-style code.
- The rule uses `createOnce`. Do per-file work in the `Program` visitor, not in `before`, because oxlint does not promise to call `before` for every file.
- Keep path logic in `src/module-path.ts`, `src/checks.ts` and `src/package-imports.ts`, free of AST types, so that the property tests can call it directly. `src/project.ts` reads the config files, and `src/syntax.ts` holds the AST helpers.
- JS plugins are alpha and not semver. Keep `@oxlint/plugins` at the same version as `oxlint`, and keep `src/__tests__/cli.spec.ts` running the real CLI.
- `fixtures/` holds projects with tsconfig, jsconfig and package.json files for `RuleTester` cases. The rule does not read imported files, so the fixtures have none.
- `fixtures/playground/` holds projects for trying patterns with the real CLI. Run `node fixtures/playground/run.ts --gaps` to compare the reports with the `// expect:` markers. Lint, format and test runs skip its projects. Its `README.md` describes it.
- For a change that needs a release, add a changeset with `pnpm changeset`. `.changeset/README.md` describes the release process.
- Run `pnpm checks` after changing this package.

## Error messages

Coding agents read these messages most, and they change code until the lint passes. A message must make the reader think about the design. It must not point to the fastest change that stops the error, such as a copy of the code or a larger public API. A person must also understand each message without the README.

Write each message in these parts, in this order:

1. **The fact:** the specifier, the paths and the names, as the rule found them.
2. **Why it matters:** one clause about what the boundary protects.
3. **The options, best first:** the first option uses what is already public. Make each condition something that the reader can check, such as "which files outside `src/teams/` need `rows`", not an opinion, such as "whether `rows` should be public". When no condition applies, the default is to remove the dependency or the export.
4. **The shortcut and its cost:** name the change that stops the error but keeps the problem. For example, a copy drifts from the first version, a list of every export makes the same leak, and an `allowedPackages` entry hides a risk.

- When a fix changes a public API or accepts a risk, say so: "a decision about the public API of `src/teams/`", or "a decision for the people who maintain this project". Then the agent asks a person, and a reviewer sees what changed.
- Do not write an instruction that an agent can follow mechanically and still miss the goal, such as "declare a new export for each value".
- Use `data` only for facts, such as paths and names. When the advice is different, use a different `messageId`.
- Before you change a message, give an agent a failing case with the new message, and look at the change that it makes.
- Keep the README's table of errors and `src/__tests__/cli.spec.ts` the same as the messages.
