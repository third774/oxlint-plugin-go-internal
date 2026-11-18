# oxlint-plugin-go-internal

## 0.1.2

### Patch Changes

- 900bf3a: Make the rule faster:

  - Find the nearest `tsconfig.json` once per directory and keep the match of each specifier, and read the filesystem again at most once per second, instead of walking the directory tree and statting the tsconfig for every import.
  - Keep the resolution of each relative specifier per directory, and skip the walk for an `internal` element when a path has no `internal` in it.
  - Check `export { x }`, `export default x` and `export = x` at the top level of a file, and `require(…)` in a file that has no binding named `require`, without scope analysis, which reads the whole file.

## 0.1.1

### Patch Changes

- 57e8e5e: Fix the README link to the Go documentation about internal packages.

## 0.1.0

### Minor Changes

- 3ec02ea: Initial release of the `go-internal/boundaries` rule, which enforces Go's `internal` directory rule on TypeScript and JavaScript imports.

### Patch Changes

- 1ba477b: Reword the error messages so that they explain why an import is not allowed and what to consider before you fix it, such as whether the code should become public API. A file outside the boundary that imports an `internal` directory now gets only the internal import error.
