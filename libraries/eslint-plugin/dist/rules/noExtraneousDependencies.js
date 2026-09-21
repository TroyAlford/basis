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
var GLOB_REGEXP_SPECIALS = '.+^${}()|[]\\';
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
var readDependencyFieldsStrict = function (packageJsonPath) {
    var cached = dependencyCache.get(packageJsonPath);
    if (cached)
        return cached;
    var pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    var fields = extractDependencyFields(pkg);
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
var mergeDependencyFields = function (target, source) {
    if (!source)
        return;
    Object.assign(target.bundledDependencies, source.bundledDependencies);
    Object.assign(target.dependencies, source.dependencies);
    Object.assign(target.devDependencies, source.devDependencies);
    Object.assign(target.optionalDependencies, source.optionalDependencies);
    Object.assign(target.peerDependencies, source.peerDependencies);
    if (source.name)
        target.name = source.name;
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
var getErrorCode = function (error) {
    if (error instanceof Error && 'code' in error)
        return String(error.code);
    return undefined;
};
var toPackageReadError = function (error) {
    if (error instanceof SyntaxError)
        return { data: { error: error.message }, messageId: 'packageUnparsable' };
    if (getErrorCode(error) === 'ENOENT')
        return { messageId: 'packageNotFound' };
    return null;
};
var collectDependencies = function (filename, packageDir) {
    var e_1, _a;
    var fields = emptyDependencyFields();
    var errors = [];
    var directories = packageDir
        ? (Array.isArray(packageDir) ? packageDir : [packageDir]).map(function (directory) { return resolve(directory); })
        : [];
    if (directories.length > 0) {
        try {
            for (var directories_1 = __values(directories), directories_1_1 = directories_1.next(); !directories_1_1.done; directories_1_1 = directories_1.next()) {
                var directory = directories_1_1.value;
                var packageJsonPath = join(directory, 'package.json');
                if (directories.length > 1) {
                    mergeDependencyFields(fields, readDependencyFields(packageJsonPath));
                    continue;
                }
                try {
                    mergeDependencyFields(fields, readDependencyFieldsStrict(packageJsonPath));
                }
                catch (error) {
                    var readError = toPackageReadError(error);
                    if (readError)
                        errors.push(readError);
                }
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (directories_1_1 && !directories_1_1.done && (_a = directories_1.return)) _a.call(directories_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
    }
    else {
        var packageJsonPath = findNearestPackageJson(filename);
        mergeDependencyFields(fields, packageJsonPath ? readDependencyFields(packageJsonPath) : null);
    }
    return { errors: errors, fields: hasAnyDependencies(fields) ? fields : null };
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
var checkDependencyDeclaration = function (deps, packageName, status) {
    if (status === void 0) { status = {
        isInBundledDeps: false,
        isInDeps: false,
        isInDevDeps: false,
        isInOptDeps: false,
        isInPeerDeps: false,
    }; }
    var hierarchy = [];
    var parts = packageName.split('/');
    parts.forEach(function (part, index) {
        if (!part.startsWith('@'))
            hierarchy.push(parts.slice(0, index + 1).join('/'));
    });
    return hierarchy.reduce(function (result, ancestorName) { return ({
        isInBundledDeps: result.isInBundledDeps || deps.bundledDependencies.includes(ancestorName),
        isInDeps: result.isInDeps || deps.dependencies[ancestorName] !== undefined,
        isInDevDeps: result.isInDevDeps || deps.devDependencies[ancestorName] !== undefined,
        isInOptDeps: result.isInOptDeps || deps.optionalDependencies[ancestorName] !== undefined,
        isInPeerDeps: result.isInPeerDeps || deps.peerDependencies[ancestorName] !== undefined,
    }); }, status);
};
var globToRegExp = function (glob) {
    var _a;
    var expression = '';
    for (var index = 0; index < glob.length; index++) {
        var character = (_a = glob[index]) !== null && _a !== void 0 ? _a : '';
        if (character === '*') {
            if (glob[index + 1] === '*') {
                index++;
                if (glob[index + 1] === '/') {
                    index++;
                    expression += '(?:.*/)?';
                }
                else {
                    expression += '.*';
                }
            }
            else {
                expression += '[^/]*';
            }
            continue;
        }
        if (character === '?') {
            expression += '[^/]';
            continue;
        }
        expression += GLOB_REGEXP_SPECIALS.includes(character) ? "\\".concat(character) : character;
    }
    return new RegExp("^".concat(expression, "$"));
};
var matchesGlob = function (filename, glob) {
    var normalizedFilename = filename.replace(/\\/g, '/');
    var cwdGlob = join(process.cwd(), glob).replace(/\\/g, '/');
    return globToRegExp(glob.replace(/\\/g, '/')).test(normalizedFilename)
        || globToRegExp(cwdGlob).test(normalizedFilename);
};
var testConfig = function (config, filename) {
    if (typeof config === 'boolean' || typeof config === 'undefined')
        return config;
    return config.some(function (glob) { return matchesGlob(filename, glob); });
};
var resolveOptions = function (options, filename) {
    var _a;
    return ({
        allowBundledDeps: testConfig(options.bundledDependencies, filename) !== false,
        allowDevDeps: testConfig(options.devDependencies, filename) !== false,
        allowModules: new Set((_a = options.allowModules) !== null && _a !== void 0 ? _a : []),
        allowOptDeps: testConfig(options.optionalDependencies, filename) !== false,
        allowPeerDeps: testConfig(options.peerDependencies, filename) !== false,
        verifyTypeImports: Boolean(options.verifyTypeImports) || Boolean(options.includeTypes),
    });
};
export var noExtraneousDependencies = {
    create: function (context) {
        var e_2, _a;
        var _b;
        var options = ((_b = context.options[0]) !== null && _b !== void 0 ? _b : {});
        var filename = context.physicalFilename;
        var resolvedOptions = resolveOptions(options, filename);
        var _c = collectDependencies(filename, options.packageDir), errors = _c.errors, fields = _c.fields;
        var deps = fields !== null && fields !== void 0 ? fields : emptyDependencyFields();
        try {
            for (var errors_1 = __values(errors), errors_1_1 = errors_1.next(); !errors_1_1.done; errors_1_1 = errors_1.next()) {
                var error = errors_1_1.value;
                context.report({ data: error.data, loc: { column: 0, line: 0 }, messageId: error.messageId });
            }
        }
        catch (e_2_1) { e_2 = { error: e_2_1 }; }
        finally {
            try {
                if (errors_1_1 && !errors_1_1.done && (_a = errors_1.return)) _a.call(errors_1);
            }
            finally { if (e_2) throw e_2.error; }
        }
        var report = function (node, specifier) {
            if (!specifier || isBuiltInModule(specifier) || !isBareSpecifier(specifier))
                return;
            if (!resolvedOptions.verifyTypeImports && isTypeOnly(node))
                return;
            var packageName = getModuleOriginalName(specifier);
            if (!packageName || resolvedOptions.allowModules.has(packageName))
                return;
            /*
             * The nearest package importing itself by name (`@basis/react` inside
             * `@basis/react`) resolves internally; the original skips it as internal.
             */
            if (packageName === deps.name)
                return;
            var status = checkDependencyDeclaration(deps, packageName);
            if (status.isInDeps)
                return;
            if (resolvedOptions.allowDevDeps && status.isInDevDeps)
                return;
            if (resolvedOptions.allowPeerDeps && status.isInPeerDeps)
                return;
            if (resolvedOptions.allowOptDeps && status.isInOptDeps)
                return;
            if (resolvedOptions.allowBundledDeps && status.isInBundledDeps)
                return;
            if (status.isInDevDeps && !resolvedOptions.allowDevDeps) {
                context.report({ data: { packageName: packageName }, messageId: 'devDependency', node: node });
                return;
            }
            if (status.isInOptDeps && !resolvedOptions.allowOptDeps) {
                context.report({ data: { packageName: packageName }, messageId: 'optionalDependency', node: node });
                return;
            }
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
            devDependency: "'{{packageName}}' should be listed in the project's dependencies, not devDependencies.",
            missingDependency: [
                "'{{packageName}}' should be listed in the project's dependencies.",
                " Run 'npm i -S {{packageName}}' to add it",
            ].join(''),
            optionalDependency: "'{{packageName}}' should be listed in the project's dependencies, not optionalDependencies.",
            packageNotFound: 'The package.json file could not be found.',
            packageUnparsable: 'The package.json file could not be parsed: {{error}}',
        },
        schema: [
            {
                additionalProperties: false,
                properties: {
                    allowModules: { items: { type: 'string' }, type: 'array' },
                    bundledDependencies: { type: ['array', 'boolean'] },
                    devDependencies: { type: ['array', 'boolean'] },
                    includeInternal: { type: 'boolean' },
                    includeTypes: { type: 'boolean' },
                    optionalDependencies: { type: ['array', 'boolean'] },
                    packageDir: { type: ['array', 'string'] },
                    peerDependencies: { type: ['array', 'boolean'] },
                    verifyTypeImports: { type: 'boolean' },
                },
                type: 'object',
            },
        ],
        type: 'problem',
    },
};
