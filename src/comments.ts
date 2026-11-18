/** A module specifier in the text of a comment, with its offsets in that text. */
export interface CommentSpecifier {
  /** The specifier as it is written. */
  readonly specifier: string;
  /** The specifier to resolve. */
  readonly modulePath: string;
  readonly start: number;
  readonly end: number;
}

const TRIPLE_SLASH_PATH = /^\/\s*<reference\s+path\s*=\s*(["'])(.+?)\1/d;
const JSDOC_IMPORT_TAG = /@import\s[^@]*?\bfrom\s*(["'])([^"'\n]+)\1/dg;
const JSDOC_IMPORT_TYPE = /\bimport\(\s*(["'])([^"'\n]+)\1\s*\)/dg;

const specifierOf = (match: RegExpExecArray, modulePath: (specifier: string) => string): CommentSpecifier | undefined => {
  const specifier = match[2];
  const indices = match.indices?.[2];
  return specifier === undefined || indices === undefined
    ? undefined
    : { specifier, modulePath: modulePath(specifier), start: indices[0], end: indices[1] };
};

/** A reference path is relative to the file even without `./`. */
const referencePath = (specifier: string): string =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/') ? specifier : `./${specifier}`;

/** The path of a `/// <reference path="…" />` directive, from the text of a line comment after `//`. */
export const tripleSlashReference = (comment: string): CommentSpecifier | undefined => {
  const match = TRIPLE_SLASH_PATH.exec(comment);
  return match === null ? undefined : specifierOf(match, referencePath);
};

/** The specifiers of `@import` tags and `import('…')` types in the text of a JSDoc comment. */
export const jsdocImports = (comment: string): CommentSpecifier[] => {
  const specifiers: CommentSpecifier[] = [];
  for (const pattern of [JSDOC_IMPORT_TAG, JSDOC_IMPORT_TYPE]) {
    for (const match of comment.matchAll(pattern)) {
      const specifier = specifierOf(match, (text) => text);
      if (specifier !== undefined) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
};
