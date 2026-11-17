import path from 'node:path';

import type { Context, CreateOnceRule, Definition, ESTree, Ranged, Scope, Variable } from '@oxlint/plugins';

import { createTsconfigAliasResolver } from './aliases.ts';
import { importViolations, reExportViolation, resolveSpecifier } from './checks.ts';
import { displayPath, isInternalModule } from './module-path.ts';
import { optionsSchema, parseOptions } from './options.ts';
import type { RuleOptions } from './options.ts';

interface FileState {
  readonly importerDirectory: string;
  readonly cwd: string;
  readonly options: RuleOptions;
}

/** A name that a statement re-exports, and the node to report on. */
interface ReExport {
  readonly node: Ranged;
  readonly name: string;
}

const messages = {
  internalImport:
    '`{{specifier}}` is internal to `{{boundary}}/`. Only files under `{{boundary}}/` can import it. Import a public module of `{{boundary}}/` instead.',
  internalDirectoryImport: '`{{specifier}}` imports an `internal` directory, not a file. Import the file inside `{{path}}/` that you need.',
  internalModuleName:
    'Do not name a module `internal`. `internal` must always be a directory, so that `internal` in an import path has one meaning.',
  internalReExport:
    '`{{name}}` comes from `{{specifier}}`, which only files under `{{boundary}}/` can import. Only files inside `{{internalDirectory}}/` can re-export it. To publish it, declare a new export in this file.',
  unknownAlias:
    '`{{specifier}}` starts with `#`, but no `paths` entry in `{{tsconfig}}` matches it, so the internal-boundary check cannot read it. Add the alias to `paths`.',
  unresolvedSpecifier: 'This module specifier is not a string, so the internal-boundary check cannot read it. Use a string literal.',
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
  const aliases = createTsconfigAliasResolver();
  let current: FileState | undefined;

  const loadFile = (): FileState => {
    current = {
      importerDirectory: path.dirname(context.filename),
      cwd: context.cwd,
      options: parseOptions(context.options),
    };
    return current;
  };

  const file = (): FileState => current ?? loadFile();

  /** Reports internal imports, `internal` directory imports and unknown aliases for a module specifier that the file loads. */
  const checkImport = (node: Ranged, specifier: string): void => {
    const { importerDirectory, cwd } = file();
    const resolution = resolveSpecifier(specifier, importerDirectory, aliases);
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
      case 'Targets':
        for (const violation of importViolations(importerDirectory, resolution.targets)) {
          if (violation._tag === 'InternalImport') {
            context.report({
              node,
              messageId: 'internalImport',
              data: { specifier, boundary: displayPath(cwd, violation.boundary.owner) },
            });
          } else {
            context.report({
              node,
              messageId: 'internalDirectoryImport',
              data: { specifier, path: displayPath(cwd, violation.internalDirectory) },
            });
          }
        }
        return;
    }
  };

  /** Reports internal re-exports for names that the file re-exports from a module specifier. */
  const checkReExports = (specifier: string, reExports: readonly ReExport[]): void => {
    const { importerDirectory, cwd } = file();
    const resolution = resolveSpecifier(specifier, importerDirectory, aliases);
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
        data: {
          name,
          specifier,
          boundary: displayPath(cwd, boundary.owner),
          internalDirectory: displayPath(cwd, boundary.internalDirectory),
        },
      });
    }
  };

  /** Reports internal re-exports for `export { x }` and `export default x`, where `x` is an import binding. */
  const checkLocalReExport = (node: Ranged, identifier: ESTree.IdentifierReference): void => {
    const variable = findVariable(context.sourceCode.getScope(identifier), identifier.name);
    const source = variable === undefined ? undefined : variableImportSource(variable);
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

  const checkCall = (node: ESTree.CallExpression): void => {
    const name = calleeName(node.callee);
    if (name === undefined) {
      return;
    }
    const [argument] = node.arguments;
    const specifier = staticString(argument);
    if (isGlobalRequire(node.callee)) {
      if (specifier === undefined) {
        context.report({ node: argument ?? node, messageId: 'unresolvedSpecifier' });
      } else if (argument !== undefined) {
        checkImport(argument, specifier);
      }
      return;
    }
    if (file().options.moduleCallees.has(name) && specifier !== undefined && argument !== undefined) {
      checkImport(argument, specifier);
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
          checkLocalReExport(specifier, specifier.local);
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
        checkLocalReExport(node.declaration, node.declaration);
      }
    },
    TSExportAssignment(node: ESTree.TSExportAssignment) {
      if (node.expression.type === 'Identifier') {
        checkLocalReExport(node.expression, node.expression);
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
        checkImport(node.moduleReference.expression, node.moduleReference.expression.value);
      }
    },
    CallExpression: checkCall,
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
