---
'oxlint-plugin-go-internal': patch
---

Cache the nearest `tsconfig.json` per directory and re-check its modification time at most once per second, instead of walking the directory tree and statting the file for every import.
