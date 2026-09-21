/**
 * Ported from `eslint-plugin-import`
 * (https://github.com/import-js/eslint-plugin-import), released under the MIT
 * license. Original author: Ben Mosher <me@benmosher.com>.
 *
 * Forbids default exports and `default` aliases when linting module source.
 */
const getName = (node) => {
    if (node.type === 'Identifier')
        return node.name;
    return node.value === null ? '' : String(node.value);
};
const getSourceType = (context) => {
    const parserOptions = context.languageOptions.parserOptions;
    return parserOptions?.sourceType ?? context.languageOptions.sourceType;
};
export const noDefaultExport = {
    create(context) {
        // Ignore non-modules.
        if (getSourceType(context) !== 'module')
            return {};
        const { sourceCode } = context;
        const reportLoc = (node) => sourceCode.getFirstTokens(node)[1]?.loc;
        return {
            ExportDefaultDeclaration(node) {
                context.report({ loc: reportLoc(node), messageId: 'preferNamed', node });
            },
            ExportNamedDeclaration(node) {
                const specifiers = node.specifiers;
                for (const specifier of specifiers) {
                    if (getName(specifier.exported) !== 'default')
                        continue;
                    if (specifier.type === 'ExportDefaultSpecifier') {
                        context.report({ loc: reportLoc(node), messageId: 'preferNamed', node });
                    }
                    else if (specifier.type === 'ExportSpecifier') {
                        context.report({
                            data: { local: getName(specifier.local) },
                            loc: reportLoc(node),
                            messageId: 'noAliasDefault',
                            node,
                        });
                    }
                }
            },
        };
    },
    meta: {
        docs: {
            description: 'Forbid default exports.',
        },
        messages: {
            noAliasDefault: 'Do not alias `{{local}}` as `default`. Just export `{{local}}` itself instead.',
            preferNamed: 'Prefer named exports.',
        },
        schema: [],
        type: 'suggestion',
    },
};
