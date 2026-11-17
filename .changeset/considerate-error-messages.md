---
'oxlint-plugin-go-internal': patch
---

Reword the error messages so that they explain why an import is not allowed and what to consider before you fix it, such as whether the code should become public API. A file outside the boundary that imports an `internal` directory now gets only the internal import error.
