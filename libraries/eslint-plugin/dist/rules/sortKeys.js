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
var getPropertyName = function (node) {
    var _a, _b;
    var key = node.key;
    if (key.type === 'Literal')
        return String(key.value);
    if (key.type === 'TemplateLiteral' && key.expressions.length === 0 && key.quasis.length === 1) {
        return (_b = (_a = key.quasis[0]) === null || _a === void 0 ? void 0 : _a.value.cooked) !== null && _b !== void 0 ? _b : null;
    }
    if (key.type === 'Identifier')
        return key.name || null;
    return null;
};
export var sortKeys = {
    create: function (context) {
        var stack = null;
        var resetSpread = function (node) {
            if (node.parent.type === 'ObjectExpression' && stack)
                stack.prevName = null;
        };
        return {
            ExperimentalSpreadProperty: function (node) {
                resetSpread(node);
            },
            ObjectExpression: function () {
                stack = {
                    prevName: null,
                    prevNode: null,
                    upper: stack,
                };
            },
            'ObjectExpression:exit': function () {
                stack = stack ? stack.upper : null;
            },
            Property: function (node) {
                var _a;
                if (node.parent.type === 'ObjectPattern' || !stack)
                    return;
                var prevName = stack.prevName;
                var prevNode = stack.prevNode;
                var thisName = getPropertyName(node);
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
                        prevName: prevName,
                        thisName: thisName,
                    },
                    fix: function (fixer) {
                        var fixes = [];
                        var moveProperty = function (fromNode, toNode) {
                            var e_1, _a;
                            try {
                                for (var _b = __values(context.sourceCode.getCommentsBefore(fromNode)), _c = _b.next(); !_c.done; _c = _b.next()) {
                                    var comment = _c.value;
                                    var text = context.sourceCode.getText(comment);
                                    fixes.push(fixer.insertTextBefore(toNode, "".concat(text, "\n")));
                                    fixes.push(fixer.remove(comment));
                                }
                            }
                            catch (e_1_1) { e_1 = { error: e_1_1 }; }
                            finally {
                                try {
                                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                                }
                                finally { if (e_1) throw e_1.error; }
                            }
                            fixes.push(fixer.replaceText(toNode, context.sourceCode.getText(fromNode)));
                        };
                        moveProperty(node, prevNode);
                        moveProperty(prevNode, node);
                        return fixes;
                    },
                    loc: (_a = node.key.loc) !== null && _a !== void 0 ? _a : undefined,
                    messageId: 'sortKeys',
                    node: node,
                });
            },
            SpreadElement: function (node) {
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
        type: 'suggestion',
    },
};
