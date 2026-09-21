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
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
var BUILT_IN_MODULES = new Set(builtinModules);
var dependencyCache = new Map();
var emptyDependencyFields = function () { return ({
    bundledDependencies: [],
    dependencies: {},
    devDependencies: {},
    name: undefined,
    optionalDependencies: {},
    peerDependencies: {},
}); };
var asRecord = function (value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return {};
    return value;
};
var asArray = function (value) {
    if (Array.isArray(value))
        return value.filter(function (item) { return typeof item === 'string'; });
    return typeof value === 'object' && value !== null ? Object.keys(value) : [];
};
var extractDependencyFields = function (pkg) {
    var _a;
    return ({
        bundledDependencies: asArray((_a = pkg.bundleDependencies) !== null && _a !== void 0 ? _a : pkg.bundledDependencies),
        dependencies: asRecord(pkg.dependencies),
        devDependencies: asRecord(pkg.devDependencies),
        name: typeof pkg.name === 'string' ? pkg.name : undefined,
        optionalDependencies: asRecord(pkg.optionalDependencies),
        peerDependencies: asRecord(pkg.peerDependencies),
    });
};
var readDependencyFields = function (packageJsonPath) {
    var cached = dependencyCache.get(packageJsonPath);
    if (cached !== undefined)
        return cached;
    var fields;
    try {
        var pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        fields = extractDependencyFields(pkg);
    }
    catch (_a) {
        fields = null;
    }
    dependencyCache.set(packageJsonPath, fields);
    return fields;
};
var findNearestPackageJson = function (filename) {
    var directory = dirname(resolve(filename));
    while (true) {
        var candidate = join(directory, 'package.json');
        if (existsSync(candidate))
            return candidate;
        var parent_1 = dirname(directory);
        if (parent_1 === directory)
            return null;
        directory = parent_1;
    }
};
var hasAnyDependencies = function (fields) {
    if (fields.bundledDependencies.length > 0)
        return true;
    if (Object.keys(fields.dependencies).length > 0)
        return true;
    if (Object.keys(fields.devDependencies).length > 0)
        return true;
    if (Object.keys(fields.optionalDependencies).length > 0)
        return true;
    return Object.keys(fields.peerDependencies).length > 0;
};
var collectDependencies = function (filename) {
    var packageJsonPath = findNearestPackageJson(filename);
    var fields = packageJsonPath ? readDependencyFields(packageJsonPath) : null;
    if (!fields || !hasAnyDependencies(fields))
        return null;
    return fields;
};
var getModuleOriginalName = function (specifier) {
    var _a = __read(specifier.split('/'), 2), first = _a[0], second = _a[1];
    if (!first)
        return null;
    if (!first.startsWith('@'))
        return first;
    return second ? "".concat(first, "/").concat(second) : null;
};
var isBuiltInModule = function (specifier) {
    if (specifier === 'bun' || specifier.startsWith('bun:') || specifier.startsWith('node:'))
        return true;
    return BUILT_IN_MODULES.has(specifier);
};
var isBareSpecifier = function (specifier) {
    if (specifier.startsWith('.') || isAbsolute(specifier))
        return false;
    if (specifier.includes(':'))
        return false;
    return /^[\w@]/.test(specifier);
};
var isTypeOnly = function (node) {
    if (typeof node !== 'object' || node === null)
        return false;
    var candidate = node;
    if (candidate.importKind === 'type' || candidate.importKind === 'typeof')
        return true;
    if (candidate.exportKind === 'type')
        return true;
    if (!Array.isArray(candidate.specifiers) || candidate.specifiers.length === 0)
        return false;
    return candidate.specifiers.every(function (specifier) {
        if (typeof specifier !== 'object' || specifier === null)
            return false;
        var kind = specifier.importKind;
        return kind === 'type' || kind === 'typeof';
    });
};
var getStringLiteralValue = function (node) {
    if (node && node.type === 'Literal' && typeof node.value === 'string')
        return node.value;
    return null;
};
var isDeclared = function (deps, packageName) {
    if (deps.dependencies[packageName] !== undefined)
        return true;
    if (deps.devDependencies[packageName] !== undefined)
        return true;
    if (deps.optionalDependencies[packageName] !== undefined)
        return true;
    if (deps.peerDependencies[packageName] !== undefined)
        return true;
    return deps.bundledDependencies.includes(packageName);
};
export var noExtraneousDependencies = {
    create: function (context) {
        var _a;
        var deps = (_a = collectDependencies(context.physicalFilename)) !== null && _a !== void 0 ? _a : emptyDependencyFields();
        var report = function (node, specifier) {
            if (!specifier || isBuiltInModule(specifier) || !isBareSpecifier(specifier))
                return;
            if (isTypeOnly(node))
                return;
            var packageName = getModuleOriginalName(specifier);
            if (!packageName)
                return;
            /*
             * The nearest package importing itself by name (`@basis/react` inside
             * `@basis/react`) resolves internally; the original skips it as internal.
             */
            if (packageName === deps.name)
                return;
            if (isDeclared(deps, packageName))
                return;
            context.report({ data: { packageName: packageName }, messageId: 'missingDependency', node: node });
        };
        return {
            CallExpression: function (node) {
                if (node.callee.type !== 'Identifier' || node.callee.name !== 'require')
                    return;
                var _a = __read(node.arguments, 1), argument = _a[0];
                report(node, getStringLiteralValue(argument));
            },
            ExportAllDeclaration: function (node) {
                report(node, getStringLiteralValue(node.source));
            },
            ExportNamedDeclaration: function (node) {
                if (node.source)
                    report(node, getStringLiteralValue(node.source));
            },
            ImportDeclaration: function (node) {
                report(node, getStringLiteralValue(node.source));
            },
            ImportExpression: function (node) {
                report(node, getStringLiteralValue(node.source));
            },
            'Program:exit': function () {
                dependencyCache.clear();
            },
        };
    },
    meta: {
        docs: {
            description: 'Forbid the use of extraneous packages.',
        },
        messages: {
            missingDependency: [
                "'{{packageName}}' should be listed in the project's dependencies.",
                " Run 'npm i -S {{packageName}}' to add it",
            ].join(''),
        },
        schema: [],
        type: 'problem',
    },
};
