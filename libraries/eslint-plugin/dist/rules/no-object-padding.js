import { ESLintUtils } from '@typescript-eslint/utils';
var createRule = ESLintUtils.RuleCreator(function (name) { return "https://example.com/rule/".concat(name); });
var WHITESPACE_LINE = /^\s*[\r\n]/gm;
export var noObjectPadding = createRule({
    create: function (context) { return ({
        ObjectExpression: function (node) {
            if (node.properties.length === 0)
                return;
            var sourceCode = context.sourceCode;
            var open = sourceCode.getFirstToken(node);
            var close = sourceCode.getLastToken(node);
            var first = node.properties[0];
            var last = node.properties[node.properties.length - 1];
            var code = sourceCode.text.slice(open.range[1], close.range[0]);
            var lines = code.split('\n');
            if (lines.length === 1)
                return;
            var opening = sourceCode.text.slice(open.range[0] - 1, first.range[0]);
            var closing = sourceCode.text.slice(last.range[1] - 1, close.range[0]);
            var hasLeading = WHITESPACE_LINE.test(opening);
            var hasTailing = WHITESPACE_LINE.test(closing);
            if (hasLeading) {
                context.report({
                    fix: function (fixer) { return fixer.replaceTextRange([open.range[0] - 1, first.range[0]], opening.replace(WHITESPACE_LINE, '')); },
                    messageId: 'unexpectedPaddingStart',
                    node: first,
                });
            }
            if (hasTailing) {
                context.report({
                    fix: function (fixer) { return fixer.replaceTextRange([last.range[1] - 1, close.range[0]], closing.replace(WHITESPACE_LINE, '')); },
                    messageId: 'unexpectedPaddingEnd',
                    node: last,
                });
            }
        },
    }); },
    defaultOptions: [],
    meta: {
        docs: {
            description: 'Disallow or enforce padding lines at the beginning and end of object declarations',
        },
        fixable: 'whitespace',
        messages: {
            unexpectedPaddingEnd: 'Unexpected blank line at the end of object declaration.',
            unexpectedPaddingStart: 'Unexpected blank line at the beginning of object declaration.',
        },
        schema: [],
        type: 'layout',
    },
    name: 'no-object-padding',
});
