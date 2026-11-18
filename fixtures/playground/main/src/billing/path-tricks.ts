// Specifiers that a user might think hide the internal element.
import '../teams/internal/../index';
import '../teams/./internal/rows'; // expect: internalImport
import '../teams//internal/rows'; // expect: internalImport
import '../teams/internal/rows.ts'; // expect: internalImport
import '../teams/internal/rows.js?raw'; // expect: internalImport
import '../teams/Internal/rows'; // not reported: see "Known limits" in the README
import '../teams/internal'; // expect: internalImport
