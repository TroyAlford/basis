import { AST_NODE_TYPES, AST_TOKEN_TYPES } from '@typescript-eslint/utils';
const nameToIndexSignature = (name) => `[index: ${name}]`;
const indexSignaturePattern = `^${nameToIndexSignature('.+')}`;
const indexSignatureRegexp = new RegExp(indexSignaturePattern.replace('[', '\\[').replace(']', '\\]'));
const charCompare = (a, b) => {
    if (a < b)
        return -1;
    if (b < a)
        return 1;
    return 0;
};
const getWeight = (value) => (indexSignatureRegexp.test(value) ? 100 : 0);
const compare = (a, b) => {
    if (!a || !b)
        return 0;
    return charCompare(a, b) - getWeight(a) + getWeight(b);
};
const getObjectBody = (node) => {
    switch (node.type) {
        case AST_NODE_TYPES.TSInterfaceDeclaration:
            return node.body.body;
        case AST_NODE_TYPES.TSEnumDeclaration:
            return node.body.members;
        case AST_NODE_TYPES.TSTypeLiteral:
            return node.members;
        default:
            return [];
    }
};
const getProperty = (node) => {
    switch (node.type) {
        case AST_NODE_TYPES.TSIndexSignature: {
            const [identifier] = node.parameters;
            return { ...identifier, name: nameToIndexSignature(identifier.name) };
        }
        case AST_NODE_TYPES.TSPropertySignature:
        case AST_NODE_TYPES.TSMethodSignature:
            return node.key;
        case AST_NODE_TYPES.TSEnumMember:
            return node.id;
        default:
            return undefined;
    }
};
const getPropertyName = (node) => {
    const property = getProperty(node);
    if (!property)
        return undefined;
    switch (property.type) {
        case AST_NODE_TYPES.Literal:
            return String(property.value);
        case AST_NODE_TYPES.Identifier:
            return property.name;
        default:
            return undefined;
    }
};
const createNodeSwapper = (context) => {
    const { sourceCode } = context;
    const getIndentRange = (node) => {
        const prevSibling = sourceCode.getTokenBefore(node);
        const end = node.range[0];
        const start = prevSibling && prevSibling.loc.start.line === node.loc.start.line
            ? prevSibling.range[1] + 1
            : node.range[0] - node.loc.start.column;
        return [start, end];
    };
    const getRangeWithIndent = (node) => [getIndentRange(node)[0], node.range[1]];
    const getLineRange = (node) => {
        const [start] = getRangeWithIndent(node);
        const index = sourceCode.lineStartIndices.findIndex(n => start === n);
        if (index < 0)
            return node.range;
        const lines = 1 + node.loc.end.line - node.loc.start.line;
        return [sourceCode.lineStartIndices[index], sourceCode.lineStartIndices[index + lines]];
    };
    const getIndentText = (node) => sourceCode.text.slice(...getIndentRange(node));
    const getNodePunctuator = (node) => {
        const punctuator = sourceCode.getTokenAfter(node, {
            filter: token => token.type === AST_TOKEN_TYPES.Punctuator && token.value !== ':',
            includeComments: false,
        });
        return punctuator && /^[,;]$/.test(punctuator.value) ? punctuator : undefined;
    };
    return (fixer, nodePositions, currentNode, replaceNode) => [currentNode, replaceNode].reduce((acc, node) => {
        const otherNode = node === currentNode ? replaceNode : currentNode;
        const comments = sourceCode.getCommentsBefore(node);
        const nextSibling = sourceCode.getTokenAfter(node);
        const nodePosition = nodePositions.get(node);
        const otherPosition = nodePositions.get(otherNode);
        const isLastReplacingLast = nodePosition?.final === nodePositions.size - 1
            && nodePosition?.final === otherPosition?.initial;
        let text = [
            comments.length ? getIndentText(node) : '',
            sourceCode.getText(node),
        ].join('');
        const punctuator = getNodePunctuator(node);
        if (nextSibling && nextSibling === punctuator)
            acc.push(fixer.remove(nextSibling));
        if (!/[,;]$/.test(text))
            text += ',';
        if (isLastReplacingLast)
            text = text.replace(/,$/, '');
        if (comments.length) {
            acc.push(fixer.insertTextBefore(otherNode, comments
                .map(comment => sourceCode.getText(comment))
                .concat('')
                .join('\n')));
        }
        acc.push(fixer.insertTextBefore(otherNode, text), fixer.remove(node), ...comments.map(comment => fixer.removeRange(getLineRange(comment))));
        return acc;
    }, []);
};
// Shared with the string-enum rule. Module-internal; not part of the public API.
export const createReporter = (context, createReportObject) => {
    const swapNodes = createNodeSwapper(context);
    return (body) => {
        const sortedBody = body
            .slice(0)
            .sort((a, b) => compare(getPropertyName(a), getPropertyName(b)));
        const nodePositions = new Map(body.map(node => [node, { final: sortedBody.indexOf(node), initial: body.indexOf(node) }]));
        for (let index = 1; index < body.length; index += 1) {
            const prevNode = body[index - 1];
            const currentNode = body[index];
            const prevNodeName = getPropertyName(prevNode);
            const currentNodeName = getPropertyName(currentNode);
            if (compare(prevNodeName, currentNodeName) > 0) {
                const targetPosition = sortedBody.indexOf(currentNode);
                const replaceNode = body[targetPosition];
                const { loc, messageId } = createReportObject(currentNode);
                context.report({
                    data: {
                        order: 'asc',
                        prevName: prevNodeName,
                        thisName: currentNodeName,
                    },
                    fix: fixer => {
                        if (currentNode !== replaceNode) {
                            return swapNodes(fixer, nodePositions, currentNode, replaceNode);
                        }
                        return null;
                    },
                    loc,
                    messageId,
                    node: currentNode,
                });
            }
        }
    };
};
const interfaceInvalidOrder = [
    'Expected interface keys to be in {{ order }}ending order.',
    " '{{ thisName }}' should be before '{{ prevName }}'.",
].join('');
export const sortInterface = {
    create(context) {
        const ruleContext = context;
        const compareNodeListAndReport = createReporter(ruleContext, node => ({
            loc: node.loc,
            messageId: 'invalidOrder',
        }));
        const listener = {
            TSInterfaceDeclaration(node) {
                compareNodeListAndReport(getObjectBody(node));
            },
            TSTypeLiteral(node) {
                compareNodeListAndReport(getObjectBody(node));
            },
        };
        return listener;
    },
    meta: {
        docs: {
            description: 'require interface keys to be sorted',
        },
        fixable: 'code',
        messages: {
            invalidOrder: interfaceInvalidOrder,
        },
        schema: [],
        type: 'suggestion',
    },
};
