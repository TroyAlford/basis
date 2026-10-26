/**
 * Enforces Basis's React architecture contract on application component source.
 *
 * Basis UI is class-based: every component extends the Basis `Component`
 * (or `Editor`) hierarchy, and neither React function components nor React
 * hooks are supported. The rule detects the prohibited shapes from syntax,
 * imports, scope bindings, and JSX references rather than by banning every
 * function that happens to return React content. Pure helpers and ordinary
 * domain functions therefore remain valid.
 *
 * Test, fixture, generated, and dependency files are out of scope by default:
 * React testing mechanics legitimately use function components and hooks, and
 * a repository can still opt a path in through its own override.
 */
const REACT_SOURCE = 'react';
// React's built-in hooks, including the React 19 additions.
const REACT_HOOKS = new Set([
    'use',
    'useActionState',
    'useCallback',
    'useContext',
    'useDebugValue',
    'useDeferredValue',
    'useEffect',
    'useFormStatus',
    'useId',
    'useImperativeHandle',
    'useInsertionEffect',
    'useLayoutEffect',
    'useMemo',
    'useOptimistic',
    'useReducer',
    'useRef',
    'useState',
    'useSyncExternalStore',
    'useTransition',
]);
// React types that declare a function component.
const REACT_FUNCTION_TYPES = new Set([
    'FC',
    'FunctionComponent',
    'VoidFunctionComponent',
]);
// React class bases that bypass the Basis hierarchy.
const REACT_CLASS_BASES = new Set(['Component', 'PureComponent']);
// The React wrappers that manufacture function components.
const REACT_WRAPPERS = new Set(['forwardRef', 'memo']);
// The conventional custom-hook name shape.
const HOOK_NAME = /^use[A-Z0-9]/;
// Test, snapshot, and end-to-end lanes that may use React testing mechanics.
const TEST_FILE = /\.(?:test|spec|screenshot|e2e)\.[cm]?[jt]sx?$/i;
// Directories that are not application component source.
const SKIPPED_DIRECTORY = new RegExp([
    '(^|[\\\\/])',
    '(?:__fixtures__|__tests__|fixtures|node_modules|',
    '\\.cache|build|coverage|dist|test-results|testing|tests?)',
    '([\\\\/]|$)',
].join(''), 'i');
// Whether a node is a non-null object.
const isObject = (value) => (typeof value === 'object' && value !== null);
// Read a node's string `type`.
const nodeType = (node) => (isObject(node) && typeof node.type === 'string' ? node.type : null);
// Read an identifier or string-literal name.
const identifierName = (node) => {
    if (!isObject(node))
        return null;
    if (nodeType(node) === 'Identifier' && typeof node.name === 'string')
        return node.name;
    if (nodeType(node) === 'Literal' && typeof node.value === 'string')
        return node.value;
    return null;
};
// Whether a name is a PascalCase component-like identifier.
const isPascalCase = (name) => /^[A-Z]/.test(name);
// Whether a file is out of the rule's default application-source scope.
const isSkippedFile = (filename) => (TEST_FILE.test(filename) || SKIPPED_DIRECTORY.test(filename));
// Unwrap TypeScript and optional-chain expression wrappers.
const unwrapExpression = (node) => {
    let current = node;
    while (isObject(current)) {
        const type = nodeType(current);
        if (type === 'ChainExpression'
            || type === 'ParenthesizedExpression'
            || type === 'TSAsExpression'
            || type === 'TSNonNullExpression'
            || type === 'TSSatisfiesExpression'
            || type === 'TSTypeAssertion') {
            current = current.expression;
            continue;
        }
        break;
    }
    return current;
};
// Read a member expression's static property name.
const memberProperty = (node) => {
    const expression = unwrapExpression(node);
    if (nodeType(expression) !== 'MemberExpression' || !isObject(expression))
        return null;
    const property = expression.property;
    if (!isObject(property))
        return null;
    if (!expression.computed && nodeType(property) === 'Identifier' && typeof property.name === 'string') {
        return property.name;
    }
    if (nodeType(property) === 'Literal' && typeof property.value === 'string')
        return property.value;
    return null;
};
// Resolve a variable by walking outward through the scope chain.
const findVariable = (scope, name) => {
    let current = scope;
    while (current) {
        const variable = current.set.get(name);
        if (variable)
            return variable;
        current = current.upper;
    }
    return null;
};
// Read the import binding behind a variable, if any.
const importInfo = (variable) => {
    for (const definition of variable.defs) {
        if (definition.type !== 'ImportBinding')
            continue;
        const source = definition.parent.source.value;
        if (typeof source !== 'string')
            continue;
        if (definition.node.type === 'ImportNamespaceSpecifier') {
            return { imported: '*', kind: 'namespace', source };
        }
        if (definition.node.type === 'ImportDefaultSpecifier') {
            return { imported: 'default', kind: 'default', source };
        }
        if (definition.node.type === 'ImportSpecifier') {
            const { imported } = definition.node;
            return {
                imported: imported.type === 'Identifier' ? imported.name : String(imported.value),
                kind: 'named',
                source,
            };
        }
    }
    return null;
};
// Resolve the React export name behind an expression, following local aliases.
const reactExport = (context, node, seen = new Set()) => {
    const expression = unwrapExpression(node);
    if (!isObject(expression))
        return null;
    if (nodeType(expression) === 'Identifier' && typeof expression.name === 'string') {
        const variable = findVariable(context.sourceCode.getScope(expression), expression.name);
        if (!variable || seen.has(variable))
            return null;
        seen.add(variable);
        const imported = importInfo(variable);
        if (imported?.source === REACT_SOURCE) {
            if (imported.kind === 'named')
                return imported.imported;
            if (imported.kind === 'default')
                return 'default';
            return '*';
        }
        for (const definition of variable.defs) {
            if (definition.type === 'Variable' && definition.node.init) {
                return reactExport(context, definition.node.init, seen);
            }
        }
        return null;
    }
    if (nodeType(expression) === 'MemberExpression') {
        const property = memberProperty(expression);
        if (!property)
            return null;
        const object = reactExport(context, expression.object, seen);
        return object === '*' || object === 'default' ? property : null;
    }
    return null;
};
// Resolve an expression to a locally declared function node.
const resolveFunction = (context, node, seen = new Set()) => {
    const expression = unwrapExpression(node);
    if (!isObject(expression))
        return null;
    const type = nodeType(expression);
    if (type === 'ArrowFunctionExpression'
        || type === 'FunctionDeclaration'
        || type === 'FunctionExpression') {
        return expression;
    }
    if (type === 'CallExpression') {
        const callee = reactExport(context, expression.callee);
        if (callee && REACT_WRAPPERS.has(callee)) {
            const [argument] = expression.arguments;
            return resolveFunction(context, argument, seen);
        }
        return null;
    }
    if (type === 'Identifier' && typeof expression.name === 'string') {
        const variable = findVariable(context.sourceCode.getScope(expression), expression.name);
        return variable ? resolveVariableFunction(context, variable, seen) : null;
    }
    return null;
};
// Whether a superclass resolves to React's own Component or PureComponent.
const reactClassBase = (context, node) => {
    const resolved = reactExport(context, node);
    return resolved && REACT_CLASS_BASES.has(resolved) ? resolved : null;
};
// Whether a function contains JSX outside of nested functions and classes.
const containsJsx = (node, root, seen = new Set()) => {
    if (!isObject(node))
        return false;
    if (seen.has(node))
        return false;
    seen.add(node);
    const type = nodeType(node);
    if (type === 'JSXElement' || type === 'JSXFragment')
        return true;
    if (node !== root && (type === 'ArrowFunctionExpression'
        || type === 'ClassDeclaration'
        || type === 'ClassExpression'
        || type === 'FunctionDeclaration'
        || type === 'FunctionExpression')) {
        return false;
    }
    for (const [key, value] of Object.entries(node)) {
        if (key === 'comments' || key === 'loc' || key === 'parent' || key === 'range' || key === 'tokens')
            continue;
        if (Array.isArray(value)) {
            if (value.some(entry => containsJsx(entry, root, seen)))
                return true;
            continue;
        }
        if (containsJsx(value, root, seen))
            return true;
    }
    return false;
};
// Whether a function's body renders JSX.
const rendersJsx = (node) => containsJsx(node.body, node);
/**
 * Read the React export name behind a type reference.
 * @param context The rule context used for scope resolution.
 * @param node A `TSTypeReference` node.
 * @returns The React export name, or `null` when the reference is not React's.
 */
const typeReferenceName = (context, node) => {
    if (!isObject(node))
        return null;
    const typeName = node.typeName;
    if (!isObject(typeName))
        return null;
    if (nodeType(typeName) === 'Identifier' && typeof typeName.name === 'string') {
        const variable = findVariable(context.sourceCode.getScope(typeName), typeName.name);
        const imported = variable ? importInfo(variable) : null;
        if (imported?.source === REACT_SOURCE && imported.kind === 'named')
            return imported.imported;
        return null;
    }
    if (nodeType(typeName) === 'TSQualifiedName') {
        const property = typeName.right;
        const object = typeName.left;
        if (!isObject(property) || !isObject(object) || typeof property.name !== 'string')
            return null;
        const resolved = reactExport(context, object);
        return resolved === '*' || resolved === 'default' ? property.name : null;
    }
    return null;
};
/**
 * Whether a type annotation declares a React function component type.
 * @param context The rule context used for scope resolution.
 * @param node The node that may carry a type annotation.
 * @returns Whether the annotation is a React function component type.
 */
const hasReactFunctionType = (context, node) => {
    if (!isObject(node))
        return false;
    if (nodeType(node) === 'TSTypeReference') {
        const name = typeReferenceName(context, node);
        if (name && REACT_FUNCTION_TYPES.has(name))
            return true;
    }
    for (const [key, value] of Object.entries(node)) {
        if (key === 'comments' || key === 'loc' || key === 'parent' || key === 'range' || key === 'tokens')
            continue;
        if (Array.isArray(value)) {
            if (value.some(entry => hasReactFunctionType(context, entry)))
                return true;
            continue;
        }
        if (hasReactFunctionType(context, value))
            return true;
    }
    return false;
};
// Whether a value is a React wrapper call such as `memo(...)` or `forwardRef(...)`.
const isReactWrapperCall = (context, node) => {
    const expression = unwrapExpression(node);
    if (nodeType(expression) !== 'CallExpression' || !isObject(expression))
        return false;
    const name = reactExport(context, expression.callee);
    return name !== null && REACT_WRAPPERS.has(name);
};
/**
 * Resolve an already-found variable to a locally declared function.
 * @param context The rule context used for scope resolution.
 * @param variable The variable to resolve.
 * @param seen Variables already visited in this resolution.
 * @returns The function node, or `null`.
 */
const resolveVariableFunction = (context, variable, seen = new Set()) => {
    if (seen.has(variable))
        return null;
    seen.add(variable);
    for (const definition of variable.defs) {
        if (definition.type === 'FunctionName') {
            return resolveFunction(context, definition.node, seen);
        }
        if (definition.type === 'Variable' && definition.node.init) {
            return resolveFunction(context, definition.node.init, seen);
        }
    }
    return null;
};
/**
 * Read a JSX name as a root-plus-property path.
 * @param node A `JSXIdentifier` or `JSXMemberExpression` node.
 * @returns The path (for example `['Views', 'Card']`), or `null`.
 */
const jsxMemberPath = (node) => {
    if (!isObject(node))
        return null;
    const type = nodeType(node);
    if (type === 'JSXIdentifier' && typeof node.name === 'string')
        return [node.name];
    if (type !== 'JSXMemberExpression')
        return null;
    const objectPath = jsxMemberPath(node.object);
    const property = node.property;
    if (!objectPath || !isObject(property) || typeof property.name !== 'string')
        return null;
    return [...objectPath, property.name];
};
/**
 * Read an object literal's static property value.
 * @param node The candidate object expression.
 * @param key The property name to find.
 * @returns The property value, or `undefined`.
 */
const objectPropertyValue = (node, key) => {
    if (!isObject(node) || nodeType(node) !== 'ObjectExpression' || !Array.isArray(node.properties)) {
        return undefined;
    }
    for (const property of node.properties) {
        if (!isObject(property) || nodeType(property) !== 'Property' || property.computed)
            continue;
        if (identifierName(property.key) === key)
            return property.value;
    }
    return undefined;
};
/**
 * Resolve a property path through local object aliases to a function node.
 * @param context The rule context used for scope resolution.
 * @param node The current object or alias expression.
 * @param path The remaining property path.
 * @param index The current path index.
 * @param seen Variables already visited in this resolution.
 * @returns The function node, or `null`.
 */
const resolveObjectPath = (context, node, path, index, seen) => {
    if (index >= path.length) {
        if (isReactWrapperCall(context, node))
            return null;
        return resolveFunction(context, node);
    }
    const expression = unwrapExpression(node);
    if (!isObject(expression))
        return null;
    if (nodeType(expression) === 'ObjectExpression') {
        const key = path[index];
        if (key === undefined)
            return null;
        const value = objectPropertyValue(expression, key);
        return value === undefined ? null : resolveObjectPath(context, value, path, index + 1, seen);
    }
    if (nodeType(expression) === 'Identifier' && typeof expression.name === 'string') {
        const variable = findVariable(context.sourceCode.getScope(expression), expression.name);
        if (!variable || seen.has(variable))
            return null;
        seen.add(variable);
        for (const definition of variable.defs) {
            if (definition.type === 'Variable' && definition.node.init) {
                return resolveObjectPath(context, definition.node.init, path, index, seen);
            }
        }
    }
    return null;
};
/**
 * Resolve a JSX member target such as `Views.Card` to a local function.
 * @param context The rule context used for scope resolution.
 * @param variable The variable bound to the member's root object.
 * @param path The property path below the root.
 * @param seen Variables already visited in this resolution.
 * @returns The function node, or `null`.
 */
const resolveMemberFunction = (context, variable, path, seen = new Set()) => {
    if (seen.has(variable))
        return null;
    seen.add(variable);
    for (const definition of variable.defs) {
        if (definition.type !== 'Variable' || !definition.node.init)
            continue;
        const fn = resolveObjectPath(context, definition.node.init, path, 0, seen);
        if (fn)
            return fn;
    }
    return null;
};
/**
 * Whether a function declaration is the direct default export.
 * @param node The function or class declaration node.
 * @returns Whether its parent is `ExportDefaultDeclaration`.
 */
const isDefaultExport = (node) => {
    const parent = node?.parent;
    return parent?.type === 'ExportDefaultDeclaration';
};
/**
 * Read the name a function is bound to, including variable, property, and
 * method bindings.
 * @param node A function node.
 * @returns The bound name, or `null` for an anonymous function.
 */
const functionIdentifier = (node) => {
    if (!isObject(node))
        return null;
    const type = nodeType(node);
    if (type !== 'ArrowFunctionExpression' && type !== 'FunctionDeclaration' && type !== 'FunctionExpression') {
        return null;
    }
    if (type !== 'ArrowFunctionExpression') {
        const id = identifierName(node.id);
        if (id)
            return id;
    }
    const parent = node.parent;
    if (!isObject(parent))
        return null;
    const parentType = nodeType(parent);
    if (parentType === 'VariableDeclarator' || parentType === 'AssignmentExpression') {
        return identifierName(parentType === 'VariableDeclarator' ? parent.id : parent.left);
    }
    if (parentType === 'MethodDefinition' || parentType === 'Property' || parentType === 'PropertyDefinition') {
        return identifierName(parent.key);
    }
    return null;
};
/**
 * Whether a function is a React component or custom hook by binding name.
 * @param node The candidate function node.
 * @returns Whether the function is component or hook context.
 */
const isComponentOrHookFunction = (node) => {
    const name = functionIdentifier(node);
    if (name && (HOOK_NAME.test(name) || isPascalCase(name)))
        return true;
    if (!isObject(node))
        return false;
    const type = nodeType(node);
    if (type !== 'ArrowFunctionExpression' && type !== 'FunctionDeclaration' && type !== 'FunctionExpression') {
        return false;
    }
    return isDefaultExport(node) && rendersJsx(node);
};
/**
 * Whether a call site is inside a component or custom-hook function.
 * @param context The rule context used to read ancestors.
 * @param node The call expression node.
 * @returns Whether a component or hook encloses the call.
 */
const isInsideComponentOrHook = (context, node) => {
    const ancestors = context.sourceCode.getAncestors(node);
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        if (isComponentOrHookFunction(ancestors[index]))
            return true;
    }
    return false;
};
/**
 * Whether a class directly extends the Basis component hierarchy.
 * @param context The rule context used for scope resolution.
 * @param node The class node to inspect.
 * @param seen Classes already visited in this resolution.
 * @returns Whether the class is a Basis component.
 */
const isBasisComponentClass = (context, node, seen = new Set()) => {
    if (!isObject(node) || seen.has(node))
        return false;
    seen.add(node);
    const type = nodeType(node);
    if (type !== 'ClassDeclaration' && type !== 'ClassExpression')
        return false;
    const superClass = unwrapExpression(node.superClass);
    if (!isObject(superClass))
        return false;
    if (nodeType(superClass) === 'Identifier' && typeof superClass.name === 'string') {
        const variable = findVariable(context.sourceCode.getScope(superClass), superClass.name);
        if (!variable)
            return false;
        const imported = importInfo(variable);
        if (imported) {
            if (imported.source === 'basis/react')
                return true;
            return imported.source.startsWith('.') && (/(?:^|\/)(?:Component|Editor)\/(?:Component|Editor)(?:\.[cm]?[jt]sx?)?$/.test(imported.source));
        }
        for (const definition of variable.defs) {
            if (definition.type === 'ClassName')
                return isBasisComponentClass(context, definition.node, seen);
            if (definition.type === 'Variable' && definition.node.init) {
                if (isBasisComponentClass(context, definition.node.init, seen))
                    return true;
            }
        }
    }
    return false;
};
/**
 * Whether a call is a direct instance field initializer on a Basis component.
 * @param context The rule context used to read ancestors.
 * @param node The call expression node.
 * @returns Whether the call initializes Basis component state.
 */
const isBasisComponentMember = (context, node) => {
    const ancestors = context.sourceCode.getAncestors(node);
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        const ancestor = ancestors[index];
        const type = nodeType(ancestor);
        if (type === 'ArrowFunctionExpression'
            || type === 'FunctionDeclaration'
            || type === 'FunctionExpression'
            || type === 'MethodDefinition') {
            return false;
        }
        if (type !== 'PropertyDefinition' || !isObject(ancestor) || ancestor.static === true)
            continue;
        for (let outer = index - 1; outer >= 0; outer -= 1) {
            const owner = ancestors[outer];
            const ownerType = nodeType(owner);
            if (ownerType === 'ClassDeclaration' || ownerType === 'ClassExpression') {
                return isBasisComponentClass(context, owner);
            }
        }
        return false;
    }
    return false;
};
/**
 * Read the name of a called expression without resolving its module.
 * @param context The rule context used for React alias resolution.
 * @param callee The call target.
 * @returns The React export or local call name, or `null`.
 */
const callName = (context, callee) => {
    const react = reactExport(context, callee);
    if (react)
        return react;
    if (nodeType(callee) === 'Identifier')
        return identifierName(callee);
    if (nodeType(callee) === 'MemberExpression')
        return memberProperty(callee);
    return null;
};
/**
 * Whether a function body calls a React or custom hook.
 * @param context The rule context used for React alias resolution.
 * @param node The node to inspect.
 * @param root The function whose body is being inspected.
 * @param seen Nodes already visited.
 * @returns Whether a hook call exists outside nested functions.
 */
const containsHookCall = (context, node, root, seen = new Set()) => {
    if (!isObject(node))
        return false;
    if (seen.has(node))
        return false;
    seen.add(node);
    const type = nodeType(node);
    if (node !== root && (type === 'ArrowFunctionExpression'
        || type === 'FunctionDeclaration'
        || type === 'FunctionExpression')) {
        return false;
    }
    if (type === 'CallExpression') {
        const name = callName(context, node.callee);
        if (name && (REACT_HOOKS.has(name) || HOOK_NAME.test(name)))
            return true;
    }
    for (const [key, value] of Object.entries(node)) {
        if (key === 'comments' || key === 'loc' || key === 'parent' || key === 'range' || key === 'tokens')
            continue;
        if (Array.isArray(value)) {
            if (value.some(entry => containsHookCall(context, entry, root, seen)))
                return true;
            continue;
        }
        if (containsHookCall(context, value, root, seen))
            return true;
    }
    return false;
};
// Read a class's declared name.
const className = (node) => (node.id?.type === 'Identifier' ? node.id.name : 'anonymous');
// Read a function declaration or variable's component name.
const functionName = (node) => {
    if (node.type === 'Identifier')
        return node.name;
    if (node.type === 'VariableDeclarator') {
        return node.id.type === 'Identifier' ? node.id.name : 'anonymous';
    }
    const id = node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' ? node.id : null;
    return id?.type === 'Identifier' ? id.name : 'default';
};
// Whether a function declaration or variable declaration is exported.
const isExported = (node) => {
    const current = node;
    let parent = current?.parent;
    while (parent) {
        if (parent.type === 'ExportDefaultDeclaration' || parent.type === 'ExportNamedDeclaration')
            return true;
        if (parent.type === 'Program'
            || parent.type === 'BlockStatement'
            || parent.type === 'FunctionDeclaration'
            || parent.type === 'FunctionExpression'
            || parent.type === 'ArrowFunctionExpression') {
            return false;
        }
        parent = parent.parent;
    }
    return false;
};
/**
 * Collect same-file named exports and default-export identifiers.
 * @param program The Program node being linted.
 * @param exports The local-name-to-export-name map to populate.
 */
const collectNamedExports = (program, exports) => {
    if (!isObject(program) || !Array.isArray(program.body))
        return;
    for (const statement of program.body) {
        if (!isObject(statement))
            continue;
        const type = nodeType(statement);
        if (type === 'ExportNamedDeclaration' && !statement.source && Array.isArray(statement.specifiers)) {
            for (const specifier of statement.specifiers) {
                if (!isObject(specifier) || nodeType(specifier) !== 'ExportSpecifier')
                    continue;
                const local = identifierName(specifier.local);
                const exported = identifierName(specifier.exported);
                if (local && exported)
                    exports.set(local, exported);
            }
        }
        if (type === 'ExportDefaultDeclaration') {
            const local = identifierName(statement.declaration);
            if (local)
                exports.set(local, 'default');
        }
    }
};
// Build the reporters bound to one rule context and its already-reported nodes.
const createReporter = (context) => {
    const reported = new WeakSet();
    const reportOnce = (node, messageId, data) => {
        if (!isObject(node))
            return;
        if (reported.has(node))
            return;
        reported.add(node);
        context.report({ data, messageId, node: node });
    };
    return {
        component(node, name) {
            reportOnce(node, 'functionComponent', { name });
        },
        functionType(node, name) {
            reportOnce(node, 'reactFunctionType', { name });
        },
        hook(node, name, custom) {
            reportOnce(node, custom ? 'customHook' : 'reactHook', { name });
        },
        wrapper(node, name) {
            reportOnce(node, 'reactWrapper', { name });
        },
    };
};
export const componentArchitecture = {
    create(context) {
        if (isSkippedFile(context.physicalFilename || context.filename))
            return {};
        const reporter = createReporter(context);
        const namedExports = new Map();
        const reportFunction = (node, name) => {
            reporter.component(node, name);
        };
        const exposedComponentName = (localName, exportedName) => {
            if (isPascalCase(localName))
                return localName;
            if (exportedName && (isPascalCase(exportedName) || exportedName === 'default'))
                return exportedName;
            if (localName === 'default')
                return localName;
            return null;
        };
        const checkFunctionDeclaration = (node) => {
            const name = functionName(node);
            if (!isExported(node) && !namedExports.has(name))
                return;
            const componentName = exposedComponentName(name, isDefaultExport(node) ? 'default' : namedExports.get(name));
            if (!componentName || !rendersJsx(node))
                return;
            reportFunction(node, componentName);
        };
        const checkDefaultExport = (node) => {
            const declaration = node.declaration;
            if (declaration.type !== 'ArrowFunctionExpression' && declaration.type !== 'FunctionExpression')
                return;
            if (!rendersJsx(declaration))
                return;
            reportFunction(declaration, 'default');
        };
        const checkVariableDeclarator = (node) => {
            const name = functionName(node);
            if (!isExported(node) && !namedExports.has(name))
                return;
            const componentName = exposedComponentName(name, namedExports.get(name));
            if (!componentName)
                return;
            if (isReactWrapperCall(context, node.init) || hasReactFunctionType(context, node.id))
                return;
            const fn = resolveFunction(context, node.init);
            if (!fn || !rendersJsx(fn))
                return;
            reportFunction(fn, componentName);
        };
        const checkClass = (node) => {
            const base = reactClassBase(context, node.superClass);
            if (!base)
                return;
            context.report({
                data: { base, name: className(node) },
                messageId: 'reactClassBase',
                node: node,
            });
        };
        const checkJsxComponent = (node) => {
            if (!isObject(node))
                return;
            const name = node.name;
            if (!isObject(name))
                return;
            if (nodeType(name) === 'JSXIdentifier' && typeof name.name === 'string') {
                if (!isPascalCase(name.name))
                    return;
                const variable = findVariable(context.sourceCode.getScope(node), name.name);
                if (!variable)
                    return;
                const fn = resolveVariableFunction(context, variable);
                if (fn)
                    reportFunction(fn, name.name);
                return;
            }
            if (nodeType(name) !== 'JSXMemberExpression')
                return;
            const path = jsxMemberPath(name);
            if (!path || path.length < 2)
                return;
            const [root, ...propertyPath] = path;
            if (root === undefined)
                return;
            const variable = findVariable(context.sourceCode.getScope(node), root);
            if (!variable)
                return;
            const fn = resolveMemberFunction(context, variable, propertyPath);
            if (fn)
                reportFunction(fn, propertyPath.join('.'));
        };
        const checkTypeReference = (node) => {
            const name = typeReferenceName(context, node);
            if (name && REACT_FUNCTION_TYPES.has(name))
                reporter.functionType(node, name);
        };
        const checkCall = (node) => {
            const exportName = reactExport(context, node.callee);
            if (exportName && REACT_WRAPPERS.has(exportName)) {
                const [argument] = node.arguments;
                const fn = resolveFunction(context, argument);
                if (fn)
                    reporter.wrapper(node, exportName);
                return;
            }
            if (exportName && (REACT_HOOKS.has(exportName) || HOOK_NAME.test(exportName))) {
                reporter.hook(node, exportName, !REACT_HOOKS.has(exportName));
                return;
            }
            if (nodeType(node.callee) !== 'Identifier')
                return;
            const name = node.callee.name;
            const variable = findVariable(context.sourceCode.getScope(node.callee), name);
            const imported = variable ? importInfo(variable) : null;
            const exposedName = imported?.imported ?? name;
            if (!HOOK_NAME.test(exposedName))
                return;
            const fn = resolveFunction(context, node.callee);
            const localHook = fn ? containsHookCall(context, fn.body, fn) : false;
            const stateHook = isBasisComponentMember(context, node);
            if (localHook || stateHook || isInsideComponentOrHook(context, node)) {
                reporter.hook(node, exposedName, true);
            }
        };
        return {
            CallExpression: checkCall,
            ClassDeclaration: checkClass,
            ClassExpression: checkClass,
            ExportDefaultDeclaration: checkDefaultExport,
            FunctionDeclaration: checkFunctionDeclaration,
            JSXOpeningElement: checkJsxComponent,
            Program(program) {
                collectNamedExports(program, namedExports);
            },
            TSTypeReference: checkTypeReference,
            VariableDeclarator: checkVariableDeclarator,
        };
    },
    meta: {
        docs: {
            description: 'Enforce the Basis class-based React component architecture.',
        },
        messages: {
            customHook: [
                'Custom React hook "{{name}}" is not allowed.',
                ' Basis UI is class-based; move this logic into a Component or Editor subclass',
                ' and use its state and lifecycle methods.',
            ].join(''),
            functionComponent: [
                '"{{name}}" is used as a function component.',
                ' Convert it to a class that extends Basis "Component" or "Editor";',
                ' pure helpers and ordinary domain functions remain allowed.',
            ].join(''),
            reactClassBase: [
                'Class "{{name}}" extends React "{{base}}".',
                ' Extend Basis "Component" or "Editor" instead;',
                ' only the Basis root Component may extend React.Component.',
            ].join(''),
            reactFunctionType: [
                'React "{{name}}" is not allowed as a component type.',
                ' Declare a class that extends Basis "Component" or "Editor" instead.',
            ].join(''),
            reactHook: [
                'React hook "{{name}}" is not allowed.',
                ' Basis UI is class-based; use Component or Editor state',
                ' and lifecycle methods instead of hooks.',
            ].join(''),
            reactWrapper: [
                'React "{{name}}" creates a function component.',
                ' Convert the component to a class that extends Basis "Component" or "Editor" instead.',
            ].join(''),
        },
        schema: [],
        type: 'problem',
    },
};
