var WHITESPACE_LINE = /^\s*[\r\n]/gm;
export var noObjectPadding = {
    create: function (context) {
        return {
            ObjectExpression: function (node) {
                if (node.properties.length === 0)
                    return;
                var sourceCode = context.sourceCode;
                var open = sourceCode.getFirstToken(node);
                var close = sourceCode.getLastToken(node);
                if (!(open === null || open === void 0 ? void 0 : open.range) || !(close === null || close === void 0 ? void 0 : close.range))
                    return;
                var first = node.properties[0];
                var last = node.properties[node.properties.length - 1];
                if (!first.range || !last.range)
                    return;
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
        };
    },
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
};
