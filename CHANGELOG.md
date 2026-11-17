# oxlint-plugin-go-internal

## 0.1.0

### Minor Changes

- 3ec02ea: Initial release of the `go-internal/boundaries` rule, which enforces Go's `internal` directory rule on TypeScript and JavaScript imports.

### Patch Changes

- 1ba477b: Reword the error messages so that they explain why an import is not allowed and what to consider before you fix it, such as whether the code should become public API. A file outside the boundary that imports an `internal` directory now gets only the internal import error.
