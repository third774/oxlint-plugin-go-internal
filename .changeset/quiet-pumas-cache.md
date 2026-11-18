---
'oxlint-plugin-go-internal': patch
---

Make the rule faster:

- Find the nearest `tsconfig.json` once per directory and keep the match of each specifier, and read the filesystem again at most once per second, instead of walking the directory tree and statting the tsconfig for every import.
- Keep the resolution of each relative specifier per directory, and skip the walk for an `internal` element when a path has no `internal` in it.
- Check `export { x }`, `export default x` and `export = x` at the top level of a file, and `require(…)` in a file that has no binding named `require`, without scope analysis, which reads the whole file.
