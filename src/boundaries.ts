import path from 'node:path';

import type { Context, CreateOnceRule, Definition, ESTree, Ranged, Scope, Variable } from '@oxlint/plugins';

import { createSpecifierResolver, importViolation, reExportViolation } from './checks.ts';
import type { Importer, Resolution } from './checks.ts';
import { jsdocImports, tripleSlashReference } from './comments.ts';
import { displayPath, isInternalModule } from './module-path.ts';
import { optionsSchema, parseOptions } from './options.ts';
import type { RuleOptions } from './options.ts';
import { createProject } from './project.ts';
import {
  calleeName,
  commonJsExport,
  isCommonJsExports,
  isImportMetaUrl,
  leftmostIdentifier,
  returnedExpression,
  staticString,
  unwrapExpression,
} from './syntax.ts';
import type { CommonJsExport } from './syntax.ts';

/** An import binding at the top level of a file. */
interface ImportBinding {
  readonly source: string;
  /** Whether the binding is the whole module: `import * as x` or `import x = require(…)`. */
  readonly namespace: boolean;
  /** The export that a named import binds, such as `vi` for `import { vi as v }`. */
  readonly imported: string | undefined;
}

/** What the top-level statements of a file bind. A top-level binding cannot be shadowed there. */
interface TopLevel {
  readonly imports: ReadonlyMap<string, ImportBinding>;
  /** The names bound to `createRequire(…)`, which work as `require`. */
  readonly createdRequires: ReadonlySet<string>;
  /** The exported name of a renamed named import, so that `v` of `import { vi as v }` is `vi`. */
  readonly rename: (name: string) => string;
}

/** `require(…)`, `require.resolve(…)` and `require.context(…)`. */
type RequireMethod = 'require' | 'resolve' | 'context';

/** A use of a `require` identifier, checked when the whole file is known. */
interface RequireUse {
  readonly call: ESTree.CallExpression;
  readonly require: ESTree.IdentifierReference;
  readonly method: RequireMethod;
}

/** An assignment of a value to a CommonJS export. */
interface CommonJsAssignment {
  readonly target: CommonJsExport;
  readonly value: ESTree.Node;
}

interface FileState {
  readonly importer: Importer;
  readonly importerDirectory: string;
  readonly cwd: string;
  readonly options: RuleOptions;
  readonly topLevel: TopLevel;
  /**
   * The names bound to `createRequire(…)`: the top-level ones from the start, and the others when
   * the visitor reaches their declaration, which comes before their calls in the same function.
   */
  readonly createdRequires: Set<string>;
  readonly requireUses: RequireUse[];
  /** The `require` tokens other than `requireUses` that the visitor saw: in `import x = require(…)` and `module.require(…)`. */
  requireTokens: number;
  /** The ranges, as `rangeKey` gives them, of the calls that load a whole module as `require(…)` does, once they are known. */
  readonly loaderCalls: Set<string>;
  readonly commonJsAssignments: CommonJsAssignment[];
}

/** A node of any identifier type, such as the result of `unwrapExpression`. */
type Identifier = Extract<ESTree.Node, { readonly type: 'Identifier' }>;

/** A name that a statement re-exports, and the node to report on. */
interface ReExport {
  readonly node: Ranged;
  readonly name: string;
}

/** How `checkImport` reads a specifier. */
interface ImportOptions {
  /** The specifier to resolve, if it is not the specifier as written. */
  readonly modulePath?: string;
  /** Whether the specifier names a directory whose files the call loads, as for `require.context`. */
  readonly directory?: boolean;
  /** Whether a specifier that looks like an alias but matches none is reported. */
  readonly reportUnknownAlias?: boolean;
}

const messages = {
  internalImport:
    '`{{specifier}}` is internal to `{{boundary}}/`, so only files under `{{boundary}}/` can import it. Check whether a public module of `{{boundary}}/` already gives you what you need. If not, consider whether this code should become part of the public API of `{{boundary}}/`, or whether this file should depend on it at all. A copy of the code would be a second version that drifts from the first.',
  internalDirectoryImport:
    '`{{specifier}}` ends at `internal`, which is reserved for a directory. Import the module inside `{{path}}/` that you need, so that the import shows which private code this file uses.',
  internalModuleName:
    'Do not name a module `internal`. The name `internal` marks a directory of private code, so a module with that name gives `internal` in an import path two meanings. Rename this module, or move its code into a file inside an `internal/` directory.',
  internalReExport:
    '`{{name}}` comes from `{{specifier}}`, which is internal to `{{boundary}}/`. A re-export would make it public to every file as a side effect. If `{{name}}` should be part of the public API, declare a new export for it in this file. If not, consider whether this file needs to export it at all.',
  internalModuleExport:
    '`{{name}}` exports the whole module `{{specifier}}`, which is internal to `{{boundary}}/`. Then every export of that module is public, also the exports that are added to it later. Declare a new export for each value that should be public.',
  unknownAlias:
    '`{{specifier}}` looks like an alias, but {{reason}}, so this rule cannot check where it points. Add the alias to `paths` in a tsconfig.json or jsconfig.json, or for a `#` alias, to `imports` in package.json.',
  unresolvedSpecifier: 'This module specifier is not a string, so this rule cannot check where it points. Use a string literal.',
} satisfies Record<string, string>;

const JAVASCRIPT_FILE = /\.[cm]?jsx?$/;

/** Characters that make a Vite glob match more than one path element. */
const GLOB_CHARACTERS = /[?[\]{}]/g;

/** A key for the range of a node. A call and the call in its callee start at the same offset, so the key also has the end. */
const rangeKey = (node: Ranged): string => `${node.range[0]}:${node.range[1]}`;

const exportName = (name: ESTree.ModuleExportName): string => (name.type === 'Identifier' ? name.name : name.value);

const isCreateRequire = (name: string | undefined): boolean => name === 'createRequire' || name?.endsWith('.createRequire') === true;

const renamer =
  (imports: ReadonlyMap<string, ImportBinding>) =>
  (name: string): string => {
    const imported = imports.get(name)?.imported;
    return imported === undefined || imported === 'default' ? name : imported;
  };

/** The name that `const name = createRequire(…)` binds. */
const createdRequireName = ({ id, init }: ESTree.VariableDeclarator, rename: (name: string) => string): string | undefined => {
  const value = init === null ? undefined : unwrapExpression(init);
  return id.type === 'Identifier' && value?.type === 'CallExpression' && isCreateRequire(calleeName(value.callee, rename))
    ? id.name
    : undefined;
};

/** The import bindings and `createRequire(…)` bindings of the top-level statements. */
const topLevelBindings = (program: ESTree.Program): TopLevel => {
  const imports = new Map<string, ImportBinding>();
  const add = (name: string, binding: ImportBinding): void => {
    if (!imports.has(name)) {
      imports.set(name, binding);
    }
  };
  const aliases: ESTree.TSImportEqualsDeclaration[] = [];
  const variables: ESTree.VariableDeclaration[] = [];
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      const source = statement.source.value;
      for (const specifier of statement.specifiers) {
        add(specifier.local.name, {
          source,
          namespace: specifier.type === 'ImportNamespaceSpecifier',
          imported: specifier.type === 'ImportSpecifier' ? exportName(specifier.imported) : undefined,
        });
      }
      continue;
    }
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type === 'TSImportEqualsDeclaration') {
      const reference = declaration.moduleReference;
      if (reference.type === 'TSExternalModuleReference') {
        add(declaration.id.name, { source: reference.expression.value, namespace: true, imported: undefined });
      } else {
        aliases.push(declaration);
      }
    } else if (declaration?.type === 'VariableDeclaration') {
      variables.push(declaration);
    }
  }
  // `import a = ns.b` binds a part of the module that `ns` binds.
  for (const alias of aliases) {
    const { moduleReference } = alias;
    const identifier = moduleReference.type === 'TSExternalModuleReference' ? undefined : leftmostIdentifier(moduleReference);
    const binding = identifier === undefined ? undefined : imports.get(identifier.name);
    if (binding !== undefined) {
      add(alias.id.name, {
        source: binding.source,
        namespace: binding.namespace && moduleReference.type === 'Identifier',
        imported: undefined,
      });
    }
  }
  const rename = renamer(imports);
  const createdRequires = new Set<string>();
  for (const { declarations } of variables) {
    for (const declarator of declarations) {
      const name = createdRequireName(declarator, rename);
      if (name !== undefined) {
        createdRequires.add(name);
      }
    }
  }
  return { imports, createdRequires, rename };
};

const REQUIRE_WORD = /\brequire\b/g;

/**
 * Whether the source text has no `require` other than the `count` that the visitor saw at call,
 * member and `import x = require(…)` positions. Then no binding named `require` exists, because a
 * binding needs its name in the text. A `\u` escape can spell an identifier without its name in the text.
 */
const hasOnlyRequireReferences = (text: string, count: number): boolean =>
  !text.includes('\\u') && (text.match(REQUIRE_WORD)?.length ?? 0) === count;

const findVariable = (scope: Scope | null, name: string): Variable | undefined =>
  scope === null ? undefined : (scope.set.get(name) ?? findVariable(scope.upper, name));

/** The text for `{{reason}}` in the `unknownAlias` message. */
const unknownAliasReason = (cwd: string, resolution: Extract<Resolution, { _tag: 'UnknownAlias' }>): string => {
  const lookups = [
    resolution.config === undefined ? undefined : `the \`paths\` of \`${displayPath(cwd, resolution.config)}\``,
    resolution.packageJson === undefined ? undefined : `the \`imports\` of \`${displayPath(cwd, resolution.packageJson)}\``,
  ].filter((lookup) => lookup !== undefined);
  return lookups.length === 0 ? 'no config file that maps aliases is above this file' : `no entry in ${lookups.join(' or ')} matches it`;
};

const createVisitor = (context: Context) => {
  const resolveSpecifier = createSpecifierResolver(createProject());
  let current: FileState | undefined;

  const loadFile = (): FileState => {
    const options = parseOptions(context.options);
    const importerDirectory = path.dirname(context.filename);
    const topLevel = topLevelBindings(context.sourceCode.ast);
    current = {
      importer: {
        file: context.filename,
        directory: importerDirectory,
        aliasPrefixes: options.aliasPrefixes,
        allowedPackages: options.allowedPackages,
      },
      importerDirectory,
      cwd: context.cwd,
      options,
      topLevel,
      createdRequires: new Set(topLevel.createdRequires),
      requireUses: [],
      requireTokens: 0,
      loaderCalls: new Set(),
      commonJsAssignments: [],
    };
    return current;
  };

  const file = (): FileState => current ?? loadFile();

  const resolve = (specifier: string): Resolution => resolveSpecifier(specifier, file().importer);

  /** Reports internal imports, `internal` directory imports and unknown aliases for a module specifier that the file loads. */
  const checkImport = (node: Ranged, specifier: string, how: ImportOptions = {}): void => {
    const { importerDirectory, cwd } = file();
    const modulePath = how.modulePath ?? specifier;
    const resolution = resolve(how.directory === true ? `${modulePath.replace(/\/+$/, '')}/*` : modulePath);
    switch (resolution._tag) {
      case 'Package':
        return;
      case 'PackageInternal':
        context.report({ node, messageId: 'internalImport', data: { specifier, boundary: resolution.boundary } });
        return;
      case 'UnknownAlias':
        if (how.reportUnknownAlias !== false) {
          context.report({ node, messageId: 'unknownAlias', data: { specifier, reason: unknownAliasReason(cwd, resolution) } });
        }
        return;
      case 'Targets': {
        const violation = importViolation(importerDirectory, resolution.targets);
        if (violation?._tag === 'InternalImport') {
          context.report({
            node,
            messageId: 'internalImport',
            data: { specifier, boundary: displayPath(cwd, violation.boundary.owner) },
          });
        } else if (violation?._tag === 'InternalDirectoryImport') {
          context.report({
            node,
            messageId: 'internalDirectoryImport',
            data: { specifier, path: displayPath(cwd, violation.internalDirectory) },
          });
        }
        return;
      }
    }
  };

  /** The boundary of the internal code that a specifier points to, if the file cannot publish that code. */
  const publishedBoundary = (specifier: string): { readonly targets: readonly string[]; readonly owner: string } | undefined => {
    const resolution = resolve(specifier);
    if (resolution._tag !== 'Targets') {
      return undefined;
    }
    const boundary = reExportViolation(file().importerDirectory, resolution.targets);
    return boundary === undefined ? undefined : { targets: resolution.targets, owner: boundary.owner };
  };

  /** Reports the names that the file re-exports from a module specifier, if that module is internal code that the file cannot publish. */
  const checkReExports = (specifier: string, reExports: readonly ReExport[]): void => {
    const published = publishedBoundary(specifier);
    if (published === undefined) {
      return;
    }
    for (const { node, name } of reExports) {
      context.report({
        node,
        messageId: 'internalReExport',
        data: { name, specifier, boundary: displayPath(file().cwd, published.owner) },
      });
    }
  };

  /** The module specifier of an import binding, also of `import a = ns.b` through the binding of `ns`. */
  const importSource = (definition: Definition, seen: Set<Definition>): string | undefined => {
    if (definition.type !== 'ImportBinding' || seen.has(definition)) {
      return undefined;
    }
    seen.add(definition);
    const { node } = definition;
    if (node.type === 'TSImportEqualsDeclaration') {
      const reference = node.moduleReference;
      if (reference.type === 'TSExternalModuleReference') {
        return reference.expression.value;
      }
      const identifier = leftmostIdentifier(reference);
      const variable = identifier === undefined ? undefined : findVariable(context.sourceCode.getScope(identifier), identifier.name);
      return variable === undefined ? undefined : variableImportSource(variable, seen);
    }
    const declaration = node.parent;
    return declaration?.type === 'ImportDeclaration' ? declaration.source.value : undefined;
  };

  const variableImportSource = (variable: Variable, seen: Set<Definition>): string | undefined => {
    for (const definition of variable.defs) {
      const source = importSource(definition, seen);
      if (source !== undefined) {
        return source;
      }
    }
    return undefined;
  };

  /** The module specifier of the import binding that `identifier` refers to, in an export statement whose parent is `parent`. */
  const localImportSource = (parent: ESTree.Node, identifier: Identifier): string | undefined => {
    if (parent.type === 'Program') {
      return file().topLevel.imports.get(identifier.name)?.source;
    }
    const variable = findVariable(context.sourceCode.getScope(identifier), identifier.name);
    return variable === undefined ? undefined : variableImportSource(variable, new Set());
  };

  /** Reports internal re-exports for `export { x }` and `export default x`, where `x` is an import binding. */
  const checkLocalReExport = (parent: ESTree.Node, node: Ranged, identifier: Identifier, name = identifier.name): void => {
    const source = localImportSource(parent, identifier);
    if (source !== undefined) {
      checkReExports(source, [{ node, name }]);
    }
  };

  /**
   * The whole internal modules in a value that a top-level statement exports: a namespace import
   * binding, `import('…')`, a function that only returns `import('…')`, or an object with a spread
   * of a namespace binding, which copies the module. An object value deeper in the export, such as
   * Vue's `components: { ...icons }`, is a use of the module, not a copy of it.
   */
  const wholeModules = (value: ESTree.Node, isExported: boolean): Array<{ readonly node: Ranged; readonly specifier: string }> => {
    const returned = isExported ? returnedExpression(value) : undefined;
    const node = unwrapExpression(returned ?? value);
    const expression = node.type === 'AwaitExpression' ? unwrapExpression(node.argument) : node;
    if (expression.type === 'ImportExpression') {
      const specifier = staticString(expression.source);
      return specifier === undefined ? [] : [{ node: expression, specifier }];
    }
    if (returned !== undefined) {
      return [];
    }
    if (expression.type === 'Identifier') {
      const binding = file().topLevel.imports.get(expression.name);
      return binding?.namespace === true ? [{ node: expression, specifier: binding.source }] : [];
    }
    if (expression.type === 'ObjectExpression' && isExported) {
      return expression.properties.flatMap((property) => (property.type === 'SpreadElement' ? wholeModules(property.argument, false) : []));
    }
    return [];
  };

  /**
   * Reports a new top-level export whose value publishes a whole internal module. A file that
   * cannot import the module already gets `internalImport` for it.
   */
  const checkModuleExport = (value: ESTree.Node, name: string): void => {
    const { importerDirectory, cwd } = file();
    for (const { node, specifier } of wholeModules(value, true)) {
      const published = publishedBoundary(specifier);
      if (published !== undefined && importViolation(importerDirectory, published.targets)?._tag !== 'InternalImport') {
        context.report({
          node,
          messageId: 'internalModuleExport',
          data: { name, specifier, boundary: displayPath(cwd, published.owner) },
        });
      }
    }
  };

  const checkExportedDeclaration = (declaration: ESTree.Declaration): void => {
    if (declaration.type === 'VariableDeclaration') {
      for (const { id, init } of declaration.declarations) {
        if (id.type === 'Identifier' && init !== null) {
          checkModuleExport(init, id.name);
        }
      }
    } else if (declaration.type === 'FunctionDeclaration' && declaration.id !== null) {
      checkModuleExport(declaration, declaration.id.name);
    }
  };

  /** Whether `require` is the global one: it has no binding, or only a binding in the global scope. */
  const isGlobalRequire = (identifier: ESTree.IdentifierReference): boolean => {
    const variable = findVariable(context.sourceCode.getScope(identifier), identifier.name);
    return variable === undefined || variable.scope.type === 'global';
  };

  /** Reports a module specifier argument, if it is a string. */
  const checkStringArgument = (argument: ESTree.Argument | undefined, how?: ImportOptions): void => {
    const specifier = staticString(argument);
    if (specifier !== undefined && argument !== undefined) {
      checkImport(argument, specifier, how);
    }
  };

  /** Reports a call whose first argument is a module specifier, if the argument is a string. */
  const checkModuleCall = (node: ESTree.CallExpression): void => {
    checkStringArgument(node.arguments[0]);
  };

  /** Reports a call of a `require` function, which must have a string argument. */
  const checkRequire = (node: ESTree.CallExpression): void => {
    file().loaderCalls.add(rangeKey(node));
    const [argument] = node.arguments;
    const specifier = staticString(argument);
    if (specifier === undefined) {
      context.report({ node: argument ?? node, messageId: 'unresolvedSpecifier' });
    } else if (argument !== undefined) {
      checkImport(argument, specifier);
    }
  };

  /** Reports `import.meta.glob(…)`, whose argument is a glob or an array of globs. A glob that starts with `!` excludes files. */
  const checkGlob = (argument: ESTree.Argument | undefined): void => {
    const globs = argument?.type === 'ArrayExpression' ? argument.elements : [argument];
    for (const glob of globs) {
      const pattern = staticString(glob);
      if (pattern !== undefined && glob !== null && glob !== undefined && !pattern.startsWith('!')) {
        checkImport(glob, pattern, { modulePath: pattern.replaceAll(GLOB_CHARACTERS, '*') });
      }
    }
  };

  const checkRequireMethod = (node: ESTree.CallExpression, method: RequireMethod): void => {
    if (method === 'require') {
      checkRequire(node);
    } else {
      checkStringArgument(node.arguments[0], { directory: method === 'context' });
    }
  };

  const checkCall = (node: ESTree.CallExpression): void => {
    const { callee, arguments: args } = node;
    const state = file();
    const { createdRequires } = state;
    if (callee.type === 'Identifier' && (callee.name === 'require' || createdRequires.has(callee.name))) {
      if (createdRequires.has(callee.name)) {
        checkRequire(node);
      } else {
        state.requireUses.push({ call: node, require: callee, method: 'require' });
      }
      return;
    }
    if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier') {
      const { object, property } = callee;
      const method = property.name === 'resolve' || property.name === 'context' ? property.name : undefined;
      if (method !== undefined && createdRequires.has(object.name)) {
        checkRequireMethod(node, method);
        return;
      }
      if (method !== undefined && object.name === 'require') {
        state.requireUses.push({ call: node, require: object, method });
        return;
      }
    }
    const { rename } = state.topLevel;
    if (callee.type === 'CallExpression' && isCreateRequire(calleeName(callee.callee, rename))) {
      checkRequire(node);
      return;
    }
    const name = calleeName(callee, rename);
    switch (name) {
      case 'module.require':
        state.requireTokens += 1;
        checkRequire(node);
        return;
      case 'import.meta.resolve':
        checkStringArgument(args[0]);
        return;
      case 'import.meta.glob':
      case 'import.meta.globEager':
        checkGlob(args[0]);
        return;
      case 'import.meta.webpackContext':
        checkStringArgument(args[0], { directory: true });
        return;
      case 'Object.assign': {
        const [target, ...sources] = args;
        if (isCommonJsExports(target)) {
          for (const source of sources) {
            state.commonJsAssignments.push({ target: { _tag: 'Module' }, value: source });
          }
        }
        return;
      }
    }
    if (name !== undefined && state.options.moduleCallees.has(name)) {
      checkModuleCall(node);
    }
  };

  /**
   * Checks the uses of `require`. Scope analysis tells whether `require` is the global one, but it
   * reads the whole file, so it runs only when the file can have a binding named `require`.
   */
  const checkRequireUses = (): void => {
    const { requireUses, requireTokens, options } = file();
    if (requireUses.length === 0) {
      return;
    }
    const unbound = hasOnlyRequireReferences(context.sourceCode.text, requireUses.length + requireTokens);
    for (const { call, require, method } of requireUses) {
      if (unbound || isGlobalRequire(require)) {
        checkRequireMethod(call, method);
      } else if (options.moduleCallees.has(method === 'require' ? 'require' : `require.${method}`)) {
        checkModuleCall(call);
      }
    }
  };

  /** The specifier of a call that loads a whole module, such as `require('…')`. */
  const loadedModule = (node: ESTree.Node): string | undefined =>
    node.type === 'CallExpression' && file().loaderCalls.has(rangeKey(node)) ? staticString(node.arguments[0]) : undefined;

  /** The top-level `const x = require('…')` bindings: the name and the specifier of each. */
  const requireBindings = (): ReadonlyMap<string, string> => {
    const bindings = new Map<string, string>();
    for (const statement of context.sourceCode.ast.body) {
      if (statement.type !== 'VariableDeclaration') {
        continue;
      }
      for (const { id, init } of statement.declarations) {
        const specifier = init === null ? undefined : loadedModule(unwrapExpression(init));
        if (id.type === 'Identifier' && specifier !== undefined) {
          bindings.set(id.name, specifier);
        }
      }
    }
    return bindings;
  };

  /**
   * The internal modules and their exports that a value gives to a CommonJS export: a whole module
   * from `require('…')` or a binding of it, an export of one, as in `require('…').x`, and the
   * values and spreads of an object. A binding of one export, such as `const { x } = require('…')`,
   * is a new export, as `export const x = …` is.
   */
  const commonJsReExports = (
    value: ESTree.Node,
    name: string,
    bindings: () => ReadonlyMap<string, string>,
  ): Array<ReExport & { readonly specifier: string }> => {
    const expression = unwrapExpression(value);
    let base = expression;
    while (base.type === 'MemberExpression') {
      base = unwrapExpression(base.object);
    }
    const loaded = loadedModule(base);
    if (loaded !== undefined) {
      return [{ node: expression, name, specifier: loaded }];
    }
    if (expression.type === 'Identifier') {
      const binding = file().topLevel.imports.get(expression.name);
      const specifier = bindings().get(expression.name) ?? (binding?.namespace === true ? binding.source : undefined);
      return specifier === undefined ? [] : [{ node: expression, name, specifier }];
    }
    if (expression.type !== 'ObjectExpression') {
      return [];
    }
    return expression.properties.flatMap((property) => {
      if (property.type === 'SpreadElement') {
        return commonJsReExports(property.argument, name, bindings);
      }
      const { key } = property;
      const keyName = property.computed ? staticString(key) : key.type === 'Identifier' ? key.name : staticString(key);
      return commonJsReExports(property.value, keyName ?? name, bindings);
    });
  };

  const checkCommonJsExports = (): void => {
    const { commonJsAssignments } = file();
    if (commonJsAssignments.length === 0) {
      return;
    }
    let bindings: ReadonlyMap<string, string> | undefined;
    const lazyBindings = (): ReadonlyMap<string, string> => (bindings ??= requireBindings());
    for (const { target, value } of commonJsAssignments) {
      for (const { node, name, specifier } of commonJsReExports(value, target._tag === 'Module' ? '*' : target.name, lazyBindings)) {
        checkReExports(specifier, [{ node, name }]);
      }
    }
  };

  /** Reports `/// <reference path="…" />` directives, and in JavaScript files, the `@import` tags and `import('…')` types of JSDoc comments. */
  const checkComments = (program: ESTree.Program): void => {
    const { text } = context.sourceCode;
    const references = text.includes('<reference');
    const jsdoc = JAVASCRIPT_FILE.test(context.filename) && (text.includes('@import') || text.includes('import('));
    if (!references && !jsdoc) {
      return;
    }
    // TypeScript reads a triple-slash directive only before the first statement.
    const firstStatement = program.body[0]?.range[0] ?? text.length;
    for (const comment of context.sourceCode.getAllComments()) {
      const isDirective = comment.type === 'Line' && references && comment.range[1] <= firstStatement;
      const isJsdoc = comment.type === 'Block' && jsdoc && comment.value.startsWith('*');
      const directive = isDirective ? tripleSlashReference(comment.value) : undefined;
      const specifiers = isJsdoc ? jsdocImports(comment.value) : directive === undefined ? [] : [directive];
      // The value of a comment starts after `//` or `/*`.
      const offset = comment.range[0] + 2;
      for (const { specifier, modulePath, start, end } of specifiers) {
        checkImport({ range: [offset + start, offset + end] }, specifier, { modulePath });
      }
    }
  };

  return {
    Program(node: ESTree.Program) {
      loadFile();
      if (isInternalModule(context.filename)) {
        context.report({ node, messageId: 'internalModuleName' });
      }
      checkComments(node);
    },
    ImportDeclaration(node: ESTree.ImportDeclaration) {
      checkImport(node.source, node.source.value);
    },
    ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
      const { declaration, source, specifiers } = node;
      if (source !== null) {
        checkImport(source, source.value);
        checkReExports(
          source.value,
          specifiers.map((specifier) => ({ node: specifier, name: exportName(specifier.local) })),
        );
        return;
      }
      if (declaration?.type === 'TSImportEqualsDeclaration') {
        const reference = declaration.moduleReference;
        if (reference.type === 'TSExternalModuleReference') {
          checkReExports(reference.expression.value, [{ node: declaration.id, name: declaration.id.name }]);
          return;
        }
        const identifier = leftmostIdentifier(reference);
        if (identifier !== undefined) {
          checkLocalReExport(node.parent, declaration.id, identifier, declaration.id.name);
        }
        return;
      }
      if (declaration !== null && node.parent.type === 'Program') {
        checkExportedDeclaration(declaration);
      }
      for (const specifier of specifiers) {
        if (specifier.local.type === 'Identifier') {
          checkLocalReExport(node.parent, specifier, specifier.local);
        }
      }
    },
    ExportAllDeclaration(node: ESTree.ExportAllDeclaration) {
      const { exported, source } = node;
      checkImport(source, source.value);
      checkReExports(source.value, [exported === null ? { node, name: '*' } : { node: exported, name: exportName(exported) }]);
    },
    ExportDefaultDeclaration(node: ESTree.ExportDefaultDeclaration) {
      const declaration = unwrapExpression(node.declaration);
      if (declaration.type === 'Identifier') {
        checkLocalReExport(node.parent, declaration, declaration);
      } else if (node.parent.type === 'Program') {
        checkModuleExport(declaration, 'default');
      }
    },
    TSExportAssignment(node: ESTree.TSExportAssignment) {
      const expression = unwrapExpression(node.expression);
      if (expression.type === 'Identifier') {
        checkLocalReExport(node.parent, expression, expression);
      } else if (node.parent.type === 'Program') {
        checkModuleExport(expression, 'export =');
      }
    },
    ImportExpression(node: ESTree.ImportExpression) {
      const specifier = staticString(node.source);
      if (specifier === undefined) {
        context.report({ node: node.source, messageId: 'unresolvedSpecifier' });
      } else {
        checkImport(node.source, specifier);
      }
    },
    TSImportType(node: ESTree.TSImportType) {
      checkImport(node.source, node.source.value);
    },
    TSImportEqualsDeclaration(node: ESTree.TSImportEqualsDeclaration) {
      if (node.moduleReference.type === 'TSExternalModuleReference') {
        file().requireTokens += 1;
        checkImport(node.moduleReference.expression, node.moduleReference.expression.value);
      }
    },
    TSModuleDeclaration(node: ESTree.TSModuleDeclaration) {
      // `declare module '…' { … }` declares or augments the module with that name.
      if (node.id.type === 'Literal') {
        checkImport(node.id, node.id.value, { reportUnknownAlias: false });
      }
    },
    NewExpression(node: ESTree.NewExpression) {
      const [specifier, base] = node.arguments;
      if (node.callee.type === 'Identifier' && node.callee.name === 'URL' && isImportMetaUrl(base)) {
        checkStringArgument(specifier);
      }
    },
    VariableDeclarator(node: ESTree.VariableDeclarator) {
      const state = file();
      const name = createdRequireName(node, state.topLevel.rename);
      if (name !== undefined) {
        state.createdRequires.add(name);
      }
    },
    AssignmentExpression(node: ESTree.AssignmentExpression) {
      const target = node.operator === '=' ? commonJsExport(node.left) : undefined;
      if (target !== undefined) {
        file().commonJsAssignments.push({ target, value: node.right });
      }
    },
    CallExpression: checkCall,
    'Program:exit'() {
      checkRequireUses();
      checkCommonJsExports();
    },
  };
};

export const boundaries: CreateOnceRule = {
  meta: {
    type: 'problem',
    docs: {
      description: "Enforce Go's `internal` directory rule: a module under `P/internal/` can be imported only by files under `P/`.",
    },
    messages,
    schema: optionsSchema,
  },
  createOnce: createVisitor,
};
