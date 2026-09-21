/**
 * Ported from `eslint-plugin-import`
 * (https://github.com/import-js/eslint-plugin-import), released under the MIT
 * license. Original author: Ben Mosher <me@benmosher.com>.
 *
 * Forbids default exports and `default` aliases when linting module source.
 */
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
var getName = function (node) {
    if (node.type === 'Identifier')
        return node.name;
    return node.value === null ? '' : String(node.value);
};
var getSourceType = function (context) {
    var _a;
    var parserOptions = context.languageOptions.parserOptions;
    return (_a = parserOptions === null || parserOptions === void 0 ? void 0 : parserOptions.sourceType) !== null && _a !== void 0 ? _a : context.languageOptions.sourceType;
};
export var noDefaultExport = {
    create: function (context) {
        // Ignore non-modules.
        if (getSourceType(context) !== 'module')
            return {};
        var sourceCode = context.sourceCode;
        var reportLoc = function (node) { var _a; return (_a = sourceCode.getFirstTokens(node)[1]) === null || _a === void 0 ? void 0 : _a.loc; };
        return {
            ExportDefaultDeclaration: function (node) {
                context.report({ loc: reportLoc(node), messageId: 'preferNamed', node: node });
            },
            ExportNamedDeclaration: function (node) {
                var e_1, _a;
                var specifiers = node.specifiers;
                try {
                    for (var specifiers_1 = __values(specifiers), specifiers_1_1 = specifiers_1.next(); !specifiers_1_1.done; specifiers_1_1 = specifiers_1.next()) {
                        var specifier = specifiers_1_1.value;
                        if (getName(specifier.exported) !== 'default')
                            continue;
                        if (specifier.type === 'ExportDefaultSpecifier') {
                            context.report({ loc: reportLoc(node), messageId: 'preferNamed', node: node });
                        }
                        else if (specifier.type === 'ExportSpecifier') {
                            context.report({
                                data: { local: getName(specifier.local) },
                                loc: reportLoc(node),
                                messageId: 'noAliasDefault',
                                node: node,
                            });
                        }
                    }
                }
                catch (e_1_1) { e_1 = { error: e_1_1 }; }
                finally {
                    try {
                        if (specifiers_1_1 && !specifiers_1_1.done && (_a = specifiers_1.return)) _a.call(specifiers_1);
                    }
                    finally { if (e_1) throw e_1.error; }
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
