import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
const BUILT_IN_MODULES = new Set(builtinModules);
const dependencyCache = new Map();
const emptyDependencyFields = () => ({
    bundledDependencies: [],
    dependencies: {},
    devDependencies: {},
    name: undefined,
    optionalDependencies: {},
    peerDependencies: {},
});
const asRecord = (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return {};
    return value;
};
const asArray = (value) => {
    if (Array.isArray(value))
        return value.filter((item) => typeof item === 'string');
    return typeof value === 'object' && value !== null ? Object.keys(value) : [];
};
const extractDependencyFields = (pkg) => ({
    bundledDependencies: asArray(pkg.bundleDependencies ?? pkg.bundledDependencies),
    dependencies: asRecord(pkg.dependencies),
    devDependencies: asRecord(pkg.devDependencies),
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    optionalDependencies: asRecord(pkg.optionalDependencies),
    peerDependencies: asRecord(pkg.peerDependencies),
});
const readDependencyFields = (packageJsonPath) => {
    const cached = dependencyCache.get(packageJsonPath);
    if (cached !== undefined)
        return cached;
    let fields;
    try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        fields = extractDependencyFields(pkg);
    }
    catch {
        fields = null;
    }
    dependencyCache.set(packageJsonPath, fields);
    return fields;
};
const findNearestPackageJson = (filename) => {
    let directory = dirname(resolve(filename));
    while (true) {
        const candidate = join(directory, 'package.json');
        if (existsSync(candidate))
            return candidate;
        const parent = dirname(directory);
        if (parent === directory)
            return null;
        directory = parent;
    }
};
const hasAnyDependencies = (fields) => {
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
const collectDependencies = (filename) => {
    const packageJsonPath = findNearestPackageJson(filename);
    const fields = packageJsonPath ? readDependencyFields(packageJsonPath) : null;
    if (!fields || !hasAnyDependencies(fields))
        return null;
    return fields;
};
const getModuleOriginalName = (specifier) => {
    const [first, second] = specifier.split('/');
    if (!first)
        return null;
    if (!first.startsWith('@'))
        return first;
    return second ? `${first}/${second}` : null;
};
const isBuiltInModule = (specifier) => {
    if (specifier === 'bun' || specifier.startsWith('bun:') || specifier.startsWith('node:'))
        return true;
    return BUILT_IN_MODULES.has(specifier);
};
const isBareSpecifier = (specifier) => {
    if (specifier.startsWith('.') || isAbsolute(specifier))
        return false;
    if (specifier.includes(':'))
        return false;
    return /^[\w@]/.test(specifier);
};
const isTypeOnly = (node) => {
    if (typeof node !== 'object' || node === null)
        return false;
    const candidate = node;
    if (candidate.importKind === 'type' || candidate.importKind === 'typeof')
        return true;
    if (candidate.exportKind === 'type')
        return true;
    if (!Array.isArray(candidate.specifiers) || candidate.specifiers.length === 0)
        return false;
    return candidate.specifiers.every(specifier => {
        if (typeof specifier !== 'object' || specifier === null)
            return false;
        const kind = specifier.importKind;
        return kind === 'type' || kind === 'typeof';
    });
};
const getStringLiteralValue = (node) => {
    if (node && node.type === 'Literal' && typeof node.value === 'string')
        return node.value;
    return null;
};
const isDeclared = (deps, packageName) => {
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
export const noExtraneousDependencies = {
    create(context) {
        const deps = collectDependencies(context.physicalFilename) ?? emptyDependencyFields();
        const report = (node, specifier) => {
            if (!specifier || isBuiltInModule(specifier) || !isBareSpecifier(specifier))
                return;
            if (isTypeOnly(node))
                return;
            const packageName = getModuleOriginalName(specifier);
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
            context.report({ data: { packageName }, messageId: 'missingDependency', node });
        };
        return {
            CallExpression(node) {
                if (node.callee.type !== 'Identifier' || node.callee.name !== 'require')
                    return;
                const [argument] = node.arguments;
                report(node, getStringLiteralValue(argument));
            },
            ExportAllDeclaration(node) {
                report(node, getStringLiteralValue(node.source));
            },
            ExportNamedDeclaration(node) {
                if (node.source)
                    report(node, getStringLiteralValue(node.source));
            },
            ImportDeclaration(node) {
                report(node, getStringLiteralValue(node.source));
            },
            ImportExpression(node) {
                report(node, getStringLiteralValue(node.source));
            },
            'Program:exit'() {
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
