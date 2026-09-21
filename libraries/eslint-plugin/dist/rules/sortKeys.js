const getPropertyName = (node) => {
    const key = node.key;
    if (key.type === 'Literal')
        return String(key.value);
    if (key.type === 'TemplateLiteral' && key.expressions.length === 0 && key.quasis.length === 1) {
        return key.quasis[0]?.value.cooked ?? null;
    }
    if (key.type === 'Identifier')
        return key.name || null;
    return null;
};
export const sortKeys = {
    create(context) {
        let stack = null;
        const resetSpread = (node) => {
            if (node.parent.type === 'ObjectExpression' && stack)
                stack.prevName = null;
        };
        return {
            ExperimentalSpreadProperty(node) {
                resetSpread(node);
            },
            ObjectExpression() {
                stack = {
                    prevName: null,
                    prevNode: null,
                    upper: stack,
                };
            },
            'ObjectExpression:exit'() {
                stack = stack ? stack.upper : null;
            },
            Property(node) {
                if (node.parent.type === 'ObjectPattern' || !stack)
                    return;
                const prevName = stack.prevName;
                const prevNode = stack.prevNode;
                const thisName = getPropertyName(node);
                if (thisName !== null) {
                    stack.prevName = thisName;
                    stack.prevNode = node;
                }
                if (prevName === null || thisName === null || prevNode === null)
                    return;
                if (prevName <= thisName)
                    return;
                context.report({
                    data: {
                        order: 'asc',
                        prevName,
                        thisName,
                    },
                    fix(fixer) {
                        const fixes = [];
                        const moveProperty = (fromNode, toNode) => {
                            for (const comment of context.sourceCode.getCommentsBefore(fromNode)) {
                                const text = context.sourceCode.getText(comment);
                                fixes.push(fixer.insertTextBefore(toNode, `${text}\n`));
                                fixes.push(fixer.remove(comment));
                            }
                            fixes.push(fixer.replaceText(toNode, context.sourceCode.getText(fromNode)));
                        };
                        moveProperty(node, prevNode);
                        moveProperty(prevNode, node);
                        return fixes;
                    },
                    loc: node.key.loc ?? undefined,
                    messageId: 'sortKeys',
                    node,
                });
            },
            SpreadElement(node) {
                resetSpread(node);
            },
        };
    },
    meta: {
        docs: {
            description: 'Require object keys to be sorted.',
        },
        fixable: 'code',
        messages: {
            sortKeys: "Expected object keys to be in {{order}}ending order. '{{thisName}}' should be before '{{prevName}}'.",
        },
        schema: [],
        type: 'suggestion',
    },
};
