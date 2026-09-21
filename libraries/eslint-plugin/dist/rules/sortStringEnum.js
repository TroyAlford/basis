import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import { createReporter } from './sortInterface.js';
var stringEnumInvalidOrder = [
    'Expected string enum members to be in {{ order }}ending order.',
    " '{{ thisName }}' should be before '{{ prevName }}'.",
].join('');
export var sortStringEnum = {
    create: function (context) {
        var ruleContext = context;
        var compareNodeListAndReport = createReporter(ruleContext, function (node) { return ({
            loc: node.loc,
            messageId: 'invalidOrder',
        }); });
        var listener = {
            TSEnumDeclaration: function (node) {
                var body = node.body.members;
                var isStringEnum = body.every(function (member) {
                    var initializer = member.initializer;
                    if (!initializer || initializer.type !== AST_NODE_TYPES.Literal)
                        return false;
                    return typeof initializer.value === 'string';
                });
                if (isStringEnum)
                    compareNodeListAndReport(body);
            },
        };
        return listener;
    },
    meta: {
        docs: {
            description: 'require string enum members to be sorted',
        },
        fixable: 'code',
        messages: {
            invalidOrder: stringEnumInvalidOrder,
        },
        schema: [],
        type: 'suggestion',
    },
};
