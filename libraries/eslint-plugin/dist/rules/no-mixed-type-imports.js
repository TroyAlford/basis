export const noMixedTypeImports = {
    create(context) {
        return {
            ImportDeclaration(node) {
                // With `@typescript-eslint/parser`, this is a `TSESTree` tree; ESLint's visitor type is ESTree-only.
                const decl = node;
                const imports = {
                    type: new Set(),
                    value: new Set(),
                };
                const semi = context.sourceCode.getText(decl).endsWith(';') ? ';' : '';
                decl.specifiers.forEach(specifier => {
                    if (specifier.type !== 'ImportSpecifier')
                        return;
                    const importedName = specifier.imported.type === 'Identifier'
                        ? specifier.imported.name
                        : specifier.imported.value;
                    imports[specifier.importKind].add(importedName);
                });
                if (!imports.type.size || !imports.value.size)
                    return;
                context.report({
                    fix: fixer => fixer.replaceTextRange(decl.range, [
                        `import type { ${[...imports.type].join(', ')} } from '${decl.source.value}'${semi}`,
                        `import { ${[...imports.value].join(', ')} } from '${decl.source.value}'${semi}`,
                    ].join('\n')),
                    messageId: 'noMixedTypeImports',
                    node,
                });
            },
        };
    },
    meta: {
        docs: {
            description: 'Disallow mixing `type` and non-`type` imports on the same line.',
        },
        fixable: 'code',
        messages: {
            noMixedTypeImports: '`type` and non-`type` imports must be split onto separate statements.',
        },
        schema: [],
        type: 'suggestion',
    },
};
