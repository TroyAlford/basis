/**
 * Ported from `eslint-plugin-import`
 * (https://github.com/import-js/eslint-plugin-import), released under the MIT
 * license. Original author: Ben Mosher <me@benmosher.com>.
 *
 * Ensures consistent use of file extensions in import paths. Basis is
 * opinionated, so the extension policy is baked in rather than configurable,
 * and add/remove changes are always autofixed. Path resolution uses `node:fs`
 * rather than `eslint-module-utils`, matching the default node resolver's
 * extensions.
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
var POLICY = {
    cjs: 'always',
    css: 'always',
    jpg: 'always',
    js: 'never',
    json: 'always',
    mjs: 'always',
    png: 'always',
    scss: 'always',
    sql: 'always',
    svg: 'always',
    ts: 'never',
    tsx: 'never',
};
var RESOLVE_EXTENSIONS = ['.mjs', '.cjs', '.js', '.json', '.node'];
var DIRECTORY_PATTERN = /([\\/]|[\\/]?\.?\.)$/;
var isFile = function (file) { return existsSync(file) && statSync(file).isFile(); };
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
var replaceImportPath = function (sourceText, importPath) { return sourceText.replace(/^(['"])(.+)\1$/, function (_match, quote) { return "".concat(quote).concat(importPath).concat(quote); }); };
var getModifier = function (extension) { var _a; return (_a = POLICY[extension]) !== null && _a !== void 0 ? _a : 'never'; };
export var importExtensions = {
    create: function (context) {
        var directory = path.dirname(context.physicalFilename || context.filename);
        var resolvePath = function (importPath) {
            var e_1, _a, e_2, _b;
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
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (RESOLVE_EXTENSIONS_1_1 && !RESOLVE_EXTENSIONS_1_1.done && (_a = RESOLVE_EXTENSIONS_1.return)) _a.call(RESOLVE_EXTENSIONS_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
            try {
                for (var RESOLVE_EXTENSIONS_2 = __values(RESOLVE_EXTENSIONS), RESOLVE_EXTENSIONS_2_1 = RESOLVE_EXTENSIONS_2.next(); !RESOLVE_EXTENSIONS_2_1.done; RESOLVE_EXTENSIONS_2_1 = RESOLVE_EXTENSIONS_2.next()) {
                    var extension = RESOLVE_EXTENSIONS_2_1.value;
                    var indexFile = path.join(base, "index".concat(extension));
                    if (isFile(indexFile))
                        return indexFile;
                }
            }
            catch (e_2_1) { e_2 = { error: e_2_1 }; }
            finally {
                try {
                    if (RESOLVE_EXTENSIONS_2_1 && !RESOLVE_EXTENSIONS_2_1.done && (_b = RESOLVE_EXTENSIONS_2.return)) _b.call(RESOLVE_EXTENSIONS_2);
                }
                finally { if (e_2) throw e_2.error; }
            }
            return null;
        };
        var isCoreModule = function (importPath) {
            var base = isScoped(importPath)
                ? importPath.split('/').slice(0, 2).join('/')
                : importPath.split('/')[0];
            return base !== undefined && isBuiltin(base);
        };
        var isTypeOnly = function (node) {
            var kind = node;
            return kind.importKind === 'type' || kind.exportKind === 'type';
        };
        var isResolvableWithoutExtension = function (file) {
            var extension = path.extname(file);
            var withoutExtension = file.slice(0, -extension.length);
            return resolvePath(withoutExtension) === resolvePath(file);
        };
        var checkFileExtension = function (source, node) {
            if (!source.value || typeof source.value !== 'string')
                return;
            var importPathWithQueryString = source.value;
            if (isCoreModule(importPathWithQueryString))
                return;
            var _a = parsePath(importPathWithQueryString), hash = _a.hash, importPath = _a.pathname, query = _a.query;
            if (isExternalRootModule(importPath))
                return;
            var resolvedPath = resolvePath(importPath);
            var extension = path.extname(resolvedPath !== null && resolvedPath !== void 0 ? resolvedPath : importPath).slice(1);
            var sourceText = context.sourceCode.getText(source);
            if (extension && importPath.endsWith(".".concat(extension))) {
                if (getModifier(extension) !== 'never')
                    return;
                if (!isResolvableWithoutExtension(importPath))
                    return;
                var withoutExtension = importPath.slice(0, -(extension.length + 1));
                var pathname_1 = withoutExtension.endsWith('/index') ? withoutExtension.slice(0, -6) : withoutExtension;
                var fixedImportPath_1 = stringifyPath({ hash: hash, pathname: pathname_1, query: query });
                context.report({
                    data: { extension: extension, fixedImportPath: fixedImportPath_1, importPath: importPathWithQueryString },
                    fix: function (fixer) { return fixer.replaceText(source, replaceImportPath(sourceText, fixedImportPath_1)); },
                    messageId: 'unexpected',
                    node: source,
                });
                return;
            }
            if (!extension || isTypeOnly(node) || getModifier(extension) !== 'always')
                return;
            var pathname = DIRECTORY_PATTERN.test(importPath)
                ? "".concat(importPath.endsWith('/') ? importPath.slice(0, -1) : importPath, "/index.").concat(extension)
                : "".concat(importPath, ".").concat(extension);
            var fixedImportPath = stringifyPath({ hash: hash, pathname: pathname, query: query });
            context.report({
                data: { extension: extension, fixedImportPath: fixedImportPath, importPath: importPathWithQueryString },
                fix: function (fixer) { return fixer.replaceText(source, replaceImportPath(sourceText, fixedImportPath)); },
                messageId: 'missingKnown',
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
            missingKnown: 'Missing file extension "{{extension}}" for "{{importPath}}"',
            unexpected: 'Unexpected use of file extension "{{extension}}" for "{{importPath}}"',
        },
        schema: [],
        type: 'suggestion',
    },
};
