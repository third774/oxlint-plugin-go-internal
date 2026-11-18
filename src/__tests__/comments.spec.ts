import { describe, expect, it } from 'vitest';

import { jsdocImports, tripleSlashReference } from '../comments.ts';

describe('comments', () => {
  it('reads the path of a triple-slash reference, relative to the file', () => {
    const comment = '/ <reference path="types.d.ts" />';
    expect(tripleSlashReference(comment)).toStrictEqual({ specifier: 'types.d.ts', modulePath: './types.d.ts', start: 19, end: 29 });
    expect(tripleSlashReference("/<reference path='../x.d.ts'/>")?.modulePath).toBe('../x.d.ts');
  });

  it('ignores other triple-slash directives and comments', () => {
    expect(tripleSlashReference('/ <reference types="node" />')).toBeUndefined();
    expect(tripleSlashReference(' <reference path="x.d.ts" />')).toBeUndefined();
  });

  it('reads `@import` tags and `import()` types', () => {
    const comment = "*\n * @import { A, B } from './a'\n * @import * as c from \"./c\"\n * @type {import('./d').D}\n ";
    expect(jsdocImports(comment).map(({ specifier }) => specifier)).toStrictEqual(['./a', './c', './d']);
    const [first] = jsdocImports(comment);
    expect(first === undefined ? undefined : comment.slice(first.start, first.end)).toBe('./a');
  });
});
