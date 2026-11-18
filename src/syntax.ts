import type { ESTree } from '@oxlint/plugins';

type Node = ESTree.Node | null | undefined;

/** The value of a string literal, or of a template literal with no expressions. */
export const staticString = (node: Node): string | undefined => {
  if (node?.type === 'Literal') {
    const { value } = node;
    return typeof value === 'string' ? value : undefined;
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
};

/** The expression inside parentheses and TypeScript-only wrappers: `x` for `(x as T)`, `x satisfies T`, `x!` and `<T>x`. */
export const unwrapExpression = (node: ESTree.Node): ESTree.Node => {
  let current = node;
  while (
    current.type === 'ParenthesizedExpression' ||
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSTypeAssertion'
  ) {
    current = current.expression;
  }
  return current;
};

/** The name of a non-computed property, or of a computed property with a string key. */
export const propertyName = (member: ESTree.MemberExpression): string | undefined => {
  if (member.computed) {
    return staticString(member.property);
  }
  return member.property.type === 'Identifier' ? member.property.name : undefined;
};

const isImportMeta = (node: Node): boolean => node?.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta';

/** Whether a node is `import.meta.url`. */
export const isImportMetaUrl = (node: Node): boolean =>
  node?.type === 'MemberExpression' && isImportMeta(node.object) && propertyName(node) === 'url';

/**
 * `vi.mock` for `vi.mock(…)`, `require` for `require(…)`, `import.meta.glob` for
 * `import.meta.glob(…)`. `rename` gives the name to use for the first identifier, so that a
 * renamed import, such as `vi` in `import { vi as v } from 'vitest'`, keeps its name.
 */
export const calleeName = (callee: ESTree.Expression, rename: (name: string) => string): string | undefined => {
  if (callee.type === 'Identifier') {
    return rename(callee.name);
  }
  if (isImportMeta(callee)) {
    return 'import.meta';
  }
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    const object = calleeName(callee.object, rename);
    return object === undefined ? undefined : `${object}.${callee.property.name}`;
  }
  return undefined;
};

const isIdentifier = (node: Node, name: string): boolean => node?.type === 'Identifier' && node.name === name;

/** Whether a node is `module.exports`. */
const isModuleExports = (node: Node): boolean =>
  node?.type === 'MemberExpression' && isIdentifier(node.object, 'module') && propertyName(node) === 'exports';

/** Whether a node is `module.exports` or `exports`, the object of a CommonJS module's exports. */
export const isCommonJsExports = (node: Node): boolean => isModuleExports(node) || isIdentifier(node, 'exports');

/** What an assignment to a CommonJS export sets: all of `module.exports`, or one named export. */
export type CommonJsExport = { readonly _tag: 'Module' } | { readonly _tag: 'Named'; readonly name: string };

/** The CommonJS export that an assignment target sets: `module.exports`, `module.exports.x` or `exports.x`. */
export const commonJsExport = (target: ESTree.AssignmentTarget): CommonJsExport | undefined => {
  if (target.type !== 'MemberExpression') {
    return undefined;
  }
  if (isModuleExports(target)) {
    return { _tag: 'Module' };
  }
  const name = propertyName(target);
  return name !== undefined && isCommonJsExports(target.object) ? { _tag: 'Named', name } : undefined;
};

/** The expression that a function returns, if its body is only that expression or one `return`. */
export const returnedExpression = (node: ESTree.Node): ESTree.Expression | undefined => {
  if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression' && node.type !== 'FunctionDeclaration') {
    return undefined;
  }
  const { body } = node;
  if (body === null || body === undefined) {
    return undefined;
  }
  if (body.type !== 'BlockStatement') {
    return body;
  }
  const [statement, ...rest] = body.body;
  return rest.length === 0 && statement?.type === 'ReturnStatement' ? (statement.argument ?? undefined) : undefined;
};

/** The first name of an entity name: `ns` for `ns.a.b`. */
export const leftmostIdentifier = (name: ESTree.TSTypeName): ESTree.IdentifierReference | undefined => {
  let current = name;
  while (current.type === 'TSQualifiedName') {
    current = current.left;
  }
  return current.type === 'Identifier' ? current : undefined;
};
