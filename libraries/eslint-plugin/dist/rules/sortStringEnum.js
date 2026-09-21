import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import { createReporter } from './sortInterface.js';
const stringEnumInvalidOrder = [
    'Expected string enum members to be in {{ order }}ending order.',
    " '{{ thisName }}' should be before '{{ prevName }}'.",
].join('');
export const sortStringEnum = {
    create(context) {
        const ruleContext = context;
        const compareNodeListAndReport = createReporter(ruleContext, node => ({
            loc: node.loc,
            messageId: 'invalidOrder',
        }));
        const listener = {
            TSEnumDeclaration(node) {
                const body = node.body.members;
                const isStringEnum = body.every(member => {
                    const { initializer } = member;
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
