var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
import { AST_NODE_TYPES, AST_TOKEN_TYPES } from '@typescript-eslint/utils';
var nameToIndexSignature = function (name) { return "[index: ".concat(name, "]"); };
var indexSignaturePattern = "^".concat(nameToIndexSignature('.+'));
var indexSignatureRegexp = new RegExp(indexSignaturePattern.replace('[', '\\[').replace(']', '\\]'));
var charCompare = function (a, b) {
    if (a < b)
        return -1;
    if (b < a)
        return 1;
    return 0;
};
var getWeight = function (value) { return (indexSignatureRegexp.test(value) ? 100 : 0); };
var compare = function (a, b) {
    if (!a || !b)
        return 0;
    return charCompare(a, b) - getWeight(a) + getWeight(b);
};
var getObjectBody = function (node) {
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
var getProperty = function (node) {
    switch (node.type) {
        case AST_NODE_TYPES.TSIndexSignature: {
            var _a = __read(node.parameters, 1), identifier = _a[0];
            return __assign(__assign({}, identifier), { name: nameToIndexSignature(identifier.name) });
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
var getPropertyName = function (node) {
    var property = getProperty(node);
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
var createNodeSwapper = function (context) {
    var sourceCode = context.sourceCode;
    var getIndentRange = function (node) {
        var prevSibling = sourceCode.getTokenBefore(node);
        var end = node.range[0];
        var start = prevSibling && prevSibling.loc.start.line === node.loc.start.line
            ? prevSibling.range[1] + 1
            : node.range[0] - node.loc.start.column;
        return [start, end];
    };
    var getRangeWithIndent = function (node) { return [getIndentRange(node)[0], node.range[1]]; };
    var getLineRange = function (node) {
        var _a = __read(getRangeWithIndent(node), 1), start = _a[0];
        var index = sourceCode.lineStartIndices.findIndex(function (n) { return start === n; });
        if (index < 0)
            return node.range;
        var lines = 1 + node.loc.end.line - node.loc.start.line;
        return [sourceCode.lineStartIndices[index], sourceCode.lineStartIndices[index + lines]];
    };
    var getIndentText = function (node) {
        var _a;
        return (_a = sourceCode.text).slice.apply(_a, __spreadArray([], __read(getIndentRange(node)), false));
    };
    var getNodePunctuator = function (node) {
        var punctuator = sourceCode.getTokenAfter(node, {
            filter: function (token) { return token.type === AST_TOKEN_TYPES.Punctuator && token.value !== ':'; },
            includeComments: false,
        });
        return punctuator && /^[,;]$/.test(punctuator.value) ? punctuator : undefined;
    };
    return function (fixer, nodePositions, currentNode, replaceNode) { return [currentNode, replaceNode].reduce(function (acc, node) {
        var otherNode = node === currentNode ? replaceNode : currentNode;
        var comments = sourceCode.getCommentsBefore(node);
        var nextSibling = sourceCode.getTokenAfter(node);
        var nodePosition = nodePositions.get(node);
        var otherPosition = nodePositions.get(otherNode);
        var isLastReplacingLast = (nodePosition === null || nodePosition === void 0 ? void 0 : nodePosition.final) === nodePositions.size - 1
            && (nodePosition === null || nodePosition === void 0 ? void 0 : nodePosition.final) === (otherPosition === null || otherPosition === void 0 ? void 0 : otherPosition.initial);
        var text = [
            comments.length ? getIndentText(node) : '',
            sourceCode.getText(node),
        ].join('');
        var punctuator = getNodePunctuator(node);
        if (nextSibling && nextSibling === punctuator)
            acc.push(fixer.remove(nextSibling));
        if (!/[,;]$/.test(text))
            text += ',';
        if (isLastReplacingLast)
            text = text.replace(/,$/, '');
        if (comments.length) {
            acc.push(fixer.insertTextBefore(otherNode, comments
                .map(function (comment) { return sourceCode.getText(comment); })
                .concat('')
                .join('\n')));
        }
        acc.push.apply(acc, __spreadArray([fixer.insertTextBefore(otherNode, text),
            fixer.remove(node)], __read(comments.map(function (comment) { return fixer.removeRange(getLineRange(comment)); })), false));
        return acc;
    }, []); };
};
// Shared with the string-enum rule. Module-internal; not part of the public API.
export var createReporter = function (context, createReportObject) {
    var swapNodes = createNodeSwapper(context);
    return function (body) {
        var sortedBody = body
            .slice(0)
            .sort(function (a, b) { return compare(getPropertyName(a), getPropertyName(b)); });
        var nodePositions = new Map(body.map(function (node) { return [node, { final: sortedBody.indexOf(node), initial: body.indexOf(node) }]; }));
        var _loop_1 = function (index) {
            var prevNode = body[index - 1];
            var currentNode = body[index];
            var prevNodeName = getPropertyName(prevNode);
            var currentNodeName = getPropertyName(currentNode);
            if (compare(prevNodeName, currentNodeName) > 0) {
                var targetPosition = sortedBody.indexOf(currentNode);
                var replaceNode_1 = body[targetPosition];
                var _a = createReportObject(currentNode), loc = _a.loc, messageId = _a.messageId;
                context.report({
                    data: {
                        order: 'asc',
                        prevName: prevNodeName,
                        thisName: currentNodeName,
                    },
                    fix: function (fixer) {
                        if (currentNode !== replaceNode_1) {
                            return swapNodes(fixer, nodePositions, currentNode, replaceNode_1);
                        }
                        return null;
                    },
                    loc: loc,
                    messageId: messageId,
                    node: currentNode,
                });
            }
        };
        for (var index = 1; index < body.length; index += 1) {
            _loop_1(index);
        }
    };
};
var interfaceInvalidOrder = [
    'Expected interface keys to be in {{ order }}ending order.',
    " '{{ thisName }}' should be before '{{ prevName }}'.",
].join('');
export var sortInterface = {
    create: function (context) {
        var ruleContext = context;
        var compareNodeListAndReport = createReporter(ruleContext, function (node) { return ({
            loc: node.loc,
            messageId: 'invalidOrder',
        }); });
        var listener = {
            TSInterfaceDeclaration: function (node) {
                compareNodeListAndReport(getObjectBody(node));
            },
            TSTypeLiteral: function (node) {
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
