var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { ESLintUtils } from '@typescript-eslint/utils';
var createRule = ESLintUtils.RuleCreator(function (name) { return "https://example.com/rule/".concat(name); });
export var noMixedTypeImports = createRule({
    create: function (context) { return ({
        ImportDeclaration: function (node) {
            var imports = {
                type: new Set(),
                value: new Set(),
            };
            var semi = context.sourceCode.getText(node).endsWith(';') ? ';' : '';
            node.specifiers.forEach(function (specifier) {
                if (specifier.type !== 'ImportSpecifier')
                    return;
                var importedName = specifier.imported.type === 'Identifier'
                    ? specifier.imported.name
                    : specifier.imported.value;
                imports[specifier.importKind].add(importedName);
            });
            if (!imports.type.size || !imports.value.size)
                return;
            context.report({
                fix: function (fixer) { return fixer.replaceTextRange(node.range, [
                    "import type { ".concat(__spreadArray([], __read(imports.type), false).join(', '), " } from '").concat(node.source.value, "'").concat(semi),
                    "import { ".concat(__spreadArray([], __read(imports.value), false).join(', '), " } from '").concat(node.source.value, "'").concat(semi),
                ].join('\n')); },
                messageId: 'noMixedTypeImports',
                node: node,
            });
        },
    }); },
    defaultOptions: [],
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
    name: 'no-mixed-type-imports',
});
