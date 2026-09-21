/**
 * Ported from `eslint-plugin-import`
 * (https://github.com/import-js/eslint-plugin-import), released under the MIT
 * license. Original author: Ben Mosher <me@benmosher.com>.
 *
 * Ensures consistent use of file extensions in import paths. Unlike the
 * upstream rule, Basis always autofixes add/remove changes (the shared config
 * supplies the extension map as a flat object, which the upstream plugin only
 * surfaces as suggestions). Path resolution uses `node:fs` rather than
 * `eslint-module-utils`, matching the default node resolver's extensions.
 */
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
import { existsSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
var RESOLVE_EXTENSIONS = ['.mjs', '.cjs', '.js', '.json', '.node'];
var DTS_PATTERN = /\.d\.[cm]?ts$/;
var DIRECTORY_PATTERN = /([\\/]|[\\/]?\.?\.)$/;
var modifierSchema = { enum: ['always', 'ignorePackages', 'never'] };
var patternSchema = {
    patternProperties: { '.*': modifierSchema },
    type: 'object',
};
var overrideSchema = {
    additionalProperties: false,
    items: {
        additionalProperties: false,
        properties: {
            action: { enum: ['enforce', 'ignore'], type: 'string' },
            pattern: { type: 'string' },
            patternOptions: { type: 'object' },
        },
        required: ['pattern', 'action'],
        type: 'object',
    },
    type: 'array',
};
var propertySchema = {
    properties: {
        checkTypeImports: { type: 'boolean' },
        ignorePackages: { type: 'boolean' },
        pathGroupOverrides: overrideSchema,
        pattern: patternSchema,
    },
    type: 'object',
};
var optionsSchema = {
    anyOf: [
        { additionalItems: false, items: [modifierSchema], type: 'array' },
        { additionalItems: false, items: [modifierSchema, propertySchema], type: 'array' },
        { additionalItems: false, items: [propertySchema], type: 'array' },
        { additionalItems: false, items: [patternSchema], type: 'array' },
        { additionalItems: false, items: [modifierSchema, patternSchema], type: 'array' },
    ],
};
var MODIFIERS = {
    always: 'always',
    ignorePackages: 'ignorePackages',
    never: 'never',
};
var isModifier = function (value) { return typeof value === 'string' && value in MODIFIERS; };
var assignPattern = function (target, source) {
    var e_1, _a;
    try {
        for (var _b = __values(Object.entries(source)), _c = _b.next(); !_c.done; _c = _b.next()) {
            var _d = __read(_c.value, 2), extension = _d[0], value = _d[1];
            if (isModifier(value))
                target[extension] = value;
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
        }
        finally { if (e_1) throw e_1.error; }
    }
};
var buildSettings = function (options) {
    var e_2, _a;
    var settings = {
        checkTypeImports: false,
        defaultConfig: 'never',
        ignorePackages: false,
        pathGroupOverrides: [],
        pattern: {},
    };
    try {
        for (var options_1 = __values(options), options_1_1 = options_1.next(); !options_1_1.done; options_1_1 = options_1.next()) {
            var option = options_1_1.value;
            if (typeof option === 'string') {
                if (isModifier(option))
                    settings.defaultConfig = option;
                continue;
            }
            if (typeof option !== 'object' || option === null)
                continue;
            var value = option;
            var flat = value.pattern === undefined
                && value.ignorePackages === undefined
                && value.checkTypeImports === undefined;
            if (flat) {
                assignPattern(settings.pattern, value);
                continue;
            }
            if (typeof value.pattern === 'object' && value.pattern !== null) {
                assignPattern(settings.pattern, value.pattern);
            }
            if (typeof value.ignorePackages === 'boolean')
                settings.ignorePackages = value.ignorePackages;
            if (typeof value.checkTypeImports === 'boolean')
                settings.checkTypeImports = value.checkTypeImports;
            if (Array.isArray(value.pathGroupOverrides)) {
                settings.pathGroupOverrides = value.pathGroupOverrides;
            }
        }
    }
    catch (e_2_1) { e_2 = { error: e_2_1 }; }
    finally {
        try {
            if (options_1_1 && !options_1_1.done && (_a = options_1.return)) _a.call(options_1);
        }
        finally { if (e_2) throw e_2.error; }
    }
    if (settings.defaultConfig === 'ignorePackages') {
        settings.defaultConfig = 'always';
        settings.ignorePackages = true;
    }
    return settings;
};
var isFile = function (file) { return existsSync(file) && statSync(file).isFile(); };
var escapeGlobChar = function (char) { return (char === '/' ? '/' : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); };
var globToRegExp = function (pattern) {
    var source = '';
    for (var index = 0; index < pattern.length; index++) {
        var char = pattern[index];
        if (char === '*') {
            if (pattern[index + 1] === '*') {
                source += '.*';
                index++;
            }
            else {
                source += '[^/]*';
            }
        }
        else if (char === '?') {
            source += '[^/]';
        }
        else {
            source += escapeGlobChar(char);
        }
    }
    return new RegExp("^".concat(source, "$"));
};
var parsePath = function (value) {
    var hashIndex = value.indexOf('#');
    var queryIndex = value.indexOf('?');
    var hasHash = hashIndex > 0;
    var hash = hasHash ? value.slice(hashIndex) : '';
    var hasQuery = queryIndex !== -1 && (!hasHash || queryIndex < hashIndex);
    var query = hasQuery ? value.slice(queryIndex, hasHash ? hashIndex : undefined) : '';
    var pathname = hasQuery
        ? value.slice(0, queryIndex)
        : hasHash
            ? value.slice(0, hashIndex)
            : value;
    return { hash: hash, pathname: pathname, query: query };
};
var stringifyPath = function (_a) {
    var hash = _a.hash, pathname = _a.pathname, query = _a.query;
    return "".concat(pathname).concat(query).concat(hash);
};
var isScoped = function (name) { return /^@[^/]+\/?[^/]+/.test(name); };
var isExternalRootModule = function (name) {
    if (name === '.' || name === '..')
        return false;
    var slashCount = name.split('/').length - 1;
    return slashCount === 0 || (isScoped(name) && slashCount <= 1);
};
var computeOverrideAction = function (overrides, importPath) {
    var e_3, _a;
    try {
        for (var overrides_1 = __values(overrides), overrides_1_1 = overrides_1.next(); !overrides_1_1.done; overrides_1_1 = overrides_1.next()) {
            var override = overrides_1_1.value;
            if (globToRegExp(override.pattern).test(importPath))
                return override.action;
        }
    }
    catch (e_3_1) { e_3 = { error: e_3_1 }; }
    finally {
        try {
            if (overrides_1_1 && !overrides_1_1.done && (_a = overrides_1.return)) _a.call(overrides_1);
        }
        finally { if (e_3) throw e_3.error; }
    }
    return undefined;
};
var replaceImportPath = function (sourceText, importPath) { return sourceText
    .replace(/^(['"])(.+)\1$/, function (_match, quote) { return "".concat(quote).concat(importPath).concat(quote); }); };
export var importExtensions = {
    create: function (context) {
        var _a;
        var settings = buildSettings(context.options);
        var directory = path.dirname(context.physicalFilename || context.filename);
        var coreModules = (_a = context.settings['import-x/core-modules']) !== null && _a !== void 0 ? _a : context.settings['import/core-modules'];
        var resolvePath = function (importPath) {
            var e_4, _a, e_5, _b;
            if (!importPath.startsWith('.') && !path.isAbsolute(importPath))
                return null;
            var base = path.isAbsolute(importPath) ? importPath : path.resolve(directory, importPath);
            if (isFile(base))
                return base;
            try {
                for (var RESOLVE_EXTENSIONS_1 = __values(RESOLVE_EXTENSIONS), RESOLVE_EXTENSIONS_1_1 = RESOLVE_EXTENSIONS_1.next(); !RESOLVE_EXTENSIONS_1_1.done; RESOLVE_EXTENSIONS_1_1 = RESOLVE_EXTENSIONS_1.next()) {
                    var extension = RESOLVE_EXTENSIONS_1_1.value;
                    if (isFile("".concat(base).concat(extension)))
                        return "".concat(base).concat(extension);
                }
            }
            catch (e_4_1) { e_4 = { error: e_4_1 }; }
            finally {
                try {
                    if (RESOLVE_EXTENSIONS_1_1 && !RESOLVE_EXTENSIONS_1_1.done && (_a = RESOLVE_EXTENSIONS_1.return)) _a.call(RESOLVE_EXTENSIONS_1);
                }
                finally { if (e_4) throw e_4.error; }
            }
            try {
                for (var RESOLVE_EXTENSIONS_2 = __values(RESOLVE_EXTENSIONS), RESOLVE_EXTENSIONS_2_1 = RESOLVE_EXTENSIONS_2.next(); !RESOLVE_EXTENSIONS_2_1.done; RESOLVE_EXTENSIONS_2_1 = RESOLVE_EXTENSIONS_2.next()) {
                    var extension = RESOLVE_EXTENSIONS_2_1.value;
                    var indexFile = path.join(base, "index".concat(extension));
                    if (isFile(indexFile))
                        return indexFile;
                }
            }
            catch (e_5_1) { e_5 = { error: e_5_1 }; }
            finally {
                try {
                    if (RESOLVE_EXTENSIONS_2_1 && !RESOLVE_EXTENSIONS_2_1.done && (_b = RESOLVE_EXTENSIONS_2.return)) _b.call(RESOLVE_EXTENSIONS_2);
                }
                finally { if (e_5) throw e_5.error; }
            }
            return null;
        };
        var isCoreModule = function (importPath) {
            var base = isScoped(importPath)
                ? importPath.split('/').slice(0, 2).join('/')
                : importPath.split('/')[0];
            if (base !== undefined && isBuiltin(base))
                return true;
            return Array.isArray(coreModules) && coreModules.includes(base);
        };
        var isPackage = function (importPath) { return isScoped(importPath) || /^\w/.test(importPath); };
        var isTypeOnly = function (node) {
            var kind = node;
            return kind.importKind === 'type' || kind.exportKind === 'type';
        };
        var getModifier = function (extension) { var _a; return (_a = settings.pattern[extension]) !== null && _a !== void 0 ? _a : settings.defaultConfig; };
        var isUseOfExtensionRequired = function (extension, packageImport) {
            var modifier = getModifier(extension);
            return modifier === 'always' && (!settings.ignorePackages || !packageImport);
        };
        var isUseOfExtensionForbidden = function (extension) { return getModifier(extension) === 'never'; };
        var isResolvableWithoutExtension = function (file) {
            var extension = path.extname(file);
            var withoutExtension = file.slice(0, -extension.length);
            return resolvePath(withoutExtension) === resolvePath(file);
        };
        var checkFileExtension = function (source, node) {
            if (!source.value || typeof source.value !== 'string')
                return;
            var importPathWithQueryString = source.value;
            var overrideAction = computeOverrideAction(settings.pathGroupOverrides, importPathWithQueryString);
            if (overrideAction === 'ignore')
                return;
            if (!overrideAction && isCoreModule(importPathWithQueryString))
                return;
            var _a = parsePath(importPathWithQueryString), hash = _a.hash, importPath = _a.pathname, query = _a.query;
            if (!overrideAction && isExternalRootModule(importPath))
                return;
            var resolvedPath = resolvePath(importPath);
            var resolvedToDts = resolvedPath !== null && DTS_PATTERN.test(resolvedPath);
            var extension = path.extname(resolvedToDts ? importPath : resolvedPath !== null && resolvedPath !== void 0 ? resolvedPath : importPath).slice(1);
            var packageImport = !overrideAction && isPackage(importPath);
            if (!extension || !importPath.endsWith(".".concat(extension))) {
                if (resolvedToDts && !extension && isPackage(importPath))
                    return;
                if (!settings.checkTypeImports && isTypeOnly(node))
                    return;
                var extensionRequired = isUseOfExtensionRequired(extension, packageImport);
                var extensionForbidden = isUseOfExtensionForbidden(extension);
                if (!extensionRequired || extensionForbidden)
                    return;
                if (!extension) {
                    context.report({
                        data: { importPath: importPathWithQueryString },
                        messageId: 'missing',
                        node: source,
                    });
                    return;
                }
                var pathname_1 = DIRECTORY_PATTERN.test(importPath)
                    ? "".concat(importPath.endsWith('/') ? importPath.slice(0, -1) : importPath, "/index.").concat(extension)
                    : "".concat(importPath, ".").concat(extension);
                var fixedImportPath_1 = stringifyPath({ hash: hash, pathname: pathname_1, query: query });
                var sourceText_1 = context.sourceCode.getText(source);
                context.report({
                    data: { extension: extension, fixedImportPath: fixedImportPath_1, importPath: importPathWithQueryString },
                    fix: function (fixer) { return fixer.replaceText(source, replaceImportPath(sourceText_1, fixedImportPath_1)); },
                    messageId: 'missingKnown',
                    node: source,
                });
                return;
            }
            if (!extension)
                return;
            if (!isUseOfExtensionForbidden(extension) || !isResolvableWithoutExtension(importPath))
                return;
            var withoutExtension = importPath.slice(0, -(extension.length + 1));
            var pathname = withoutExtension.endsWith('/index') ? withoutExtension.slice(0, -6) : withoutExtension;
            var fixedImportPath = stringifyPath({ hash: hash, pathname: pathname, query: query });
            var sourceText = context.sourceCode.getText(source);
            context.report({
                data: { extension: extension, fixedImportPath: fixedImportPath, importPath: importPathWithQueryString },
                fix: function (fixer) { return fixer.replaceText(source, replaceImportPath(sourceText, fixedImportPath)); },
                messageId: 'unexpected',
                node: source,
            });
        };
        var checkSource = function (source, node) {
            if ((source === null || source === void 0 ? void 0 : source.type) === 'Literal')
                checkFileExtension(source, node);
        };
        return {
            CallExpression: function (node) {
                var callee = node.callee;
                if (callee.type === 'Import') {
                    var _a = __read(node.arguments, 1), argument_1 = _a[0];
                    if (argument_1 && argument_1.type === 'Literal')
                        checkSource(argument_1, node);
                    return;
                }
                if (callee.type !== 'Identifier' || callee.name !== 'require' || node.arguments.length !== 1)
                    return;
                var _b = __read(node.arguments, 1), argument = _b[0];
                if (argument && argument.type === 'Literal')
                    checkSource(argument, node);
            },
            ExportAllDeclaration: function (node) {
                checkSource(node.source, node);
            },
            ExportNamedDeclaration: function (node) {
                checkSource(node.source, node);
            },
            ImportDeclaration: function (node) {
                checkSource(node.source, node);
            },
            ImportExpression: function (node) {
                checkSource(node.source, node);
            },
        };
    },
    meta: {
        docs: {
            description: 'Ensure consistent use of file extension within the import path.',
        },
        fixable: 'code',
        messages: {
            missing: 'Missing file extension for "{{importPath}}"',
            missingKnown: 'Missing file extension "{{extension}}" for "{{importPath}}"',
            unexpected: 'Unexpected use of file extension "{{extension}}" for "{{importPath}}"',
        },
        schema: optionsSchema,
        type: 'suggestion',
    },
};
