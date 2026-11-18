# Playground

Small projects that use `go-internal/boundaries` from `src/index.ts`, with one module for each way that a file can load or re-export private code. Use them to try a pattern and to see where the rule and a user's expectations differ.

```sh
node fixtures/playground/run.ts          # every line with a marker or a report
node fixtures/playground/run.ts --gaps   # only the lines where the rule and the marker disagree
```

Put `// expect: <messageId>` at the end of a line that a user would expect the rule to report. A line without a marker expects no report. `run.ts` prints `MISSED`, `FALSE POSITIVE` or `DIFFERENT` for each line where the rule disagrees. Some markers show what a user expects, not what the rule promises, so `run.ts` can show lines that differ.

| Directory                   | What it tests                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `main/src/teams/internal/`  | The private code: `rows.ts`, a barrel `index.ts`, `storage/store.ts`, `storage/internal/sql.ts` |
| `main/src/teams/reexports/` | Files under `teams/` that can import the private code but must not re-export it                 |
| `main/src/billing/`         | Files outside `teams/` that must not load the private code in any way                           |
| `vite-solution/`            | Vite's template: the root tsconfig has only `references`, and `paths` is in `tsconfig.app.json` |
| `jsconfig/`                 | A JavaScript project with `paths` in `jsconfig.json`                                            |
| `package-imports/`          | `#` aliases from package.json `imports`, not tsconfig `paths`                                   |
| `configdir/`                | `paths` with `${configDir}` in an extended base config                                          |
| `workspace/`                | A deep import into a workspace package that has no `exports` field                              |

- `playground.oxlintrc.json` is the oxlint config. It does not have the name `.oxlintrc.json`, so the lint of this repository does not use it as a nested config. To lint by hand, run `oxlint -c playground.oxlintrc.json .` in this directory.
- `tsconfig.json` here has no `paths`. It stops the projects without a tsconfig, such as `jsconfig/`, from finding this repository's tsconfig.
- The lint, format and test runs of this repository skip the projects. They check only `run.ts`.
