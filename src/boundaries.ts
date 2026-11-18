import path from 'node:path';

import type { Context, CreateOnceRule, Definition, ESTree, Ranged, Scope, Variable } from '@oxlint/plugins';

import { createTsconfigAliasResolver } from './aliases.ts';
import { createSpecifierResolver, importViolation, reExportViolation } from './checks.ts';
import { displayPath, isInternalModule } from './module-path.ts';
import { optionsSchema, parseOptions } from './options.ts';
import type { RuleOptions } from './options.ts';

interface FileState {
  readonly importerDirectory: string;
  readonly cwd: string;
  readonly options: RuleOptions;
  /** The module specifier of each import binding at the top level of the file. */
  readonly moduleImports: ReadonlyMap<string, string>;
  /** The `require(…)` calls, checked when the whole file is known. */
  readonly requireCalls: ESTree.CallExpression[];
  /** The `require(…)` of each `import x = require(…)`, which is in the source text but is not a call. */
  readonly requireReferences: ESTree.TSExternalModuleReference[];
}

/** A name that a statement re-exports, and the node to report on. */
interface ReExport {
  readonly node: Ranged;
  readonly name: string;
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
  unknownAlias:
    '`{{specifier}}` starts with `#`, but no `paths` entry in `{{tsconfig}}` matches it, so this rule cannot check where it points. Add the alias to `paths`.',
  unresolvedSpecifier: 'This module specifier is not a string, so this rule cannot check where it points. Use a string literal.',
} satisfies Record<string, string>;

/** The value of a string literal, or of a template literal with no expressions. */
const staticString = (node: ESTree.Argument | undefined): string | undefined => {
  if (node?.type === 'Literal') {
    const { value } = node;
    return typeof value === 'string' ? value : undefined;
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
};

/** `vi.mock` for `vi.mock(…)`, `require` for `require(…)`. */
const calleeName = (callee: ESTree.Expression): string | undefined => {
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const object = calleeName(callee.object);
    return object === undefined ? undefined : `${object}.${callee.property.name}`;
  }
  return undefined;
};

const exportName = (name: ESTree.ModuleExportName): string => (name.type === 'Identifier' ? name.name : name.value);

/** The module specifier of an import binding. */
const importSource = (definition: Definition): string | undefined => {
  if (definition.type !== 'ImportBinding') {
    return undefined;
  }
  const { node } = definition;
  if (node.type === 'TSImportEqualsDeclaration') {
    return node.moduleReference.type === 'TSExternalModuleReference' ? node.moduleReference.expression.value : undefined;
  }
  const declaration = node.parent;
  return declaration?.type === 'ImportDeclaration' ? declaration.source.value : undefined;
};

/**
 * The import bindings of the top-level statements. A binding at the top level cannot be shadowed
 * there, so this gives what scope analysis gives for a name that a top-level statement exports.
 */
const moduleImports = (program: ESTree.Program): ReadonlyMap<string, string> => {
  const sources = new Map<string, string>();
  const add = (name: string, source: string): void => {
    if (!sources.has(name)) {
      sources.set(name, source);
    }
  };
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) {
        add(specifier.local.name, statement.source.value);
      }
      continue;
    }
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type === 'TSImportEqualsDeclaration' && declaration.moduleReference.type === 'TSExternalModuleReference') {
      add(declaration.id.name, declaration.moduleReference.expression.value);
    }
  }
  return sources;
};

const REQUIRE_WORD = /\brequire\b/g;

/**
 * Whether the source text has no `require` other than the `count` that the visitor saw at call or
 * `import x = require(…)` positions. Then no binding named `require` exists, because a binding
 * needs its name in the text. A `\u` escape can spell an identifier without its name in the text.
 */
const hasOnlyRequireReferences = (text: string, count: number): boolean =>
  !text.includes('\\u') && (text.match(REQUIRE_WORD)?.length ?? 0) === count;

const findVariable = (scope: Scope | null, name: string): Variable | undefined =>
  scope === null ? undefined : (scope.set.get(name) ?? findVariable(scope.upper, name));

const variableImportSource = (variable: Variable): string | undefined => {
  for (const definition of variable.defs) {
    const source = importSource(definition);
    if (source !== undefined) {
      return source;
    }
  }
  return undefined;
};

const createVisitor = (context: Context) => {
  const resolveSpecifier = createSpecifierResolver(createTsconfigAliasResolver());
  let current: FileState | undefined;

  const loadFile = (): FileState => {
    current = {
      importerDirectory: path.dirname(context.filename),
      cwd: context.cwd,
      options: parseOptions(context.options),
      moduleImports: moduleImports(context.sourceCode.ast),
      requireCalls: [],
      requireReferences: [],
    };
    return current;
  };

  const file = (): FileState => current ?? loadFile();

  /** Reports internal imports, `internal` directory imports and unknown aliases for a module specifier that the file loads. */
  const checkImport = (node: Ranged, specifier: string): void => {
    const { importerDirectory, cwd } = file();
    const resolution = resolveSpecifier(specifier, importerDirectory);
    switch (resolution._tag) {
      case 'Package':
        return;
      case 'UnknownAlias':
        context.report({
          node,
          messageId: 'unknownAlias',
          data: {
            specifier,
            tsconfig: resolution.tsconfig === undefined ? 'tsconfig.json' : displayPath(cwd, resolution.tsconfig),
          },
        });
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

  /** Reports internal re-exports for names that the file re-exports from a module specifier. */
  const checkReExports = (specifier: string, reExports: readonly ReExport[]): void => {
    const { importerDirectory, cwd } = file();
    const resolution = resolveSpecifier(specifier, importerDirectory);
    if (resolution._tag !== 'Targets') {
      return;
    }
    const boundary = reExportViolation(importerDirectory, resolution.targets);
    if (boundary === undefined) {
      return;
    }
    for (const { node, name } of reExports) {
      context.report({
        node,
        messageId: 'internalReExport',
        data: { name, specifier, boundary: displayPath(cwd, boundary.owner) },
      });
    }
  };

  /** The module specifier of the import binding that `identifier` refers to, in an export statement whose parent is `parent`. */
  const localImportSource = (parent: ESTree.Node, identifier: ESTree.IdentifierReference): string | undefined => {
    if (parent.type === 'Program') {
      return file().moduleImports.get(identifier.name);
    }
    const variable = findVariable(context.sourceCode.getScope(identifier), identifier.name);
    return variable === undefined ? undefined : variableImportSource(variable);
  };

  /** Reports internal re-exports for `export { x }` and `export default x`, where `x` is an import binding. */
  const checkLocalReExport = (parent: ESTree.Node, node: Ranged, identifier: ESTree.IdentifierReference): void => {
    const source = localImportSource(parent, identifier);
    if (source !== undefined) {
      checkReExports(source, [{ node, name: identifier.name }]);
    }
  };

  /** Whether `require` is the global one: it has no binding, or only a binding in the global scope. */
  const isGlobalRequire = (callee: ESTree.Expression): boolean => {
    if (callee.type !== 'Identifier' || callee.name !== 'require') {
      return false;
    }
    const variable = findVariable(context.sourceCode.getScope(callee), callee.name);
    return variable === undefined || variable.scope.type === 'global';
  };

  /** Reports a call whose first argument is a module specifier, if the argument is a string. */
  const checkModuleCall = (node: ESTree.CallExpression): void => {
    const [argument] = node.arguments;
    const specifier = staticString(argument);
    if (specifier !== undefined && argument !== undefined) {
      checkImport(argument, specifier);
    }
  };

  /** Reports a call of the global `require`, which must have a string argument. */
  const checkRequire = (node: ESTree.CallExpression): void => {
    const [argument] = node.arguments;
    const specifier = staticString(argument);
    if (specifier === undefined) {
      context.report({ node: argument ?? node, messageId: 'unresolvedSpecifier' });
    } else if (argument !== undefined) {
      checkImport(argument, specifier);
    }
  };

  const checkCall = (node: ESTree.CallExpression): void => {
    const { callee } = node;
    if (callee.type === 'Identifier' && callee.name === 'require') {
      file().requireCalls.push(node);
      return;
    }
    const name = calleeName(callee);
    if (name !== undefined && file().options.moduleCallees.has(name)) {
      checkModuleCall(node);
    }
  };

  /**
   * Checks the `require(…)` calls. Scope analysis tells whether a call is of the global `require`,
   * but it reads the whole file, so it runs only when the file can have a binding named `require`.
   */
  const checkRequireCalls = (): void => {
    const { requireCalls, requireReferences, options } = file();
    if (requireCalls.length === 0) {
      return;
    }
    const unbound = hasOnlyRequireReferences(context.sourceCode.text, requireCalls.length + requireReferences.length);
    for (const call of requireCalls) {
      if (unbound || isGlobalRequire(call.callee)) {
        checkRequire(call);
      } else if (options.moduleCallees.has('require')) {
        checkModuleCall(call);
      }
    }
  };

  return {
    Program(node: ESTree.Program) {
      loadFile();
      if (isInternalModule(context.filename)) {
        context.report({ node, messageId: 'internalModuleName' });
      }
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
      if (declaration?.type === 'TSImportEqualsDeclaration' && declaration.moduleReference.type === 'TSExternalModuleReference') {
        checkReExports(declaration.moduleReference.expression.value, [{ node: declaration.id, name: declaration.id.name }]);
        return;
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
      if (node.declaration.type === 'Identifier') {
        checkLocalReExport(node.parent, node.declaration, node.declaration);
      }
    },
    TSExportAssignment(node: ESTree.TSExportAssignment) {
      if (node.expression.type === 'Identifier') {
        checkLocalReExport(node.parent, node.expression, node.expression);
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
        file().requireReferences.push(node.moduleReference);
        checkImport(node.moduleReference.expression, node.moduleReference.expression.value);
      }
    },
    CallExpression: checkCall,
    'Program:exit': checkRequireCalls,
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
