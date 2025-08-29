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
/* eslint-disable @import/no-default-export */
import eslint from '@eslint/js';
import pluginStylistic from '@stylistic/eslint-plugin';
import pluginImport from 'eslint-plugin-import';
import pluginImportNewlines from 'eslint-plugin-import-newlines';
import pluginJSDoc from 'eslint-plugin-jsdoc';
import pluginNamedImportSpacing from 'eslint-plugin-named-import-spacing';
import pluginImportSort from 'eslint-plugin-simple-import-sort';
import pluginSortDestructureKeys from 'eslint-plugin-sort-destructure-keys';
import pluginSortKeys from 'eslint-plugin-sort-keys-fix';
import pluginTypescriptSortKeys from 'eslint-plugin-typescript-sort-keys';
import pluginTypescript from 'typescript-eslint';
import pluginBasis from './rules/index.js';
/**
 * Creates an ESLint configuration for the basis plugin.
 * @param options - The plugin options.
 * @returns The ESLint configuration.
 */
var plugin = function (options) {
    var files = options.files, rules = options.rules;
    var config = {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        plugins: {
            '@basis': pluginBasis,
            '@import': pluginImport,
            '@import-newlines': pluginImportNewlines,
            '@jsdoc': pluginJSDoc,
            '@named-import-spacing': pluginNamedImportSpacing,
            '@stylistic': pluginStylistic,
            '@stylistic/js': pluginStylistic,
            '@stylistic/jsx': pluginStylistic,
            '@stylistic/ts': pluginStylistic,
            '@typescript-eslint': pluginTypescript.plugin,
            'simple-import-sort': pluginImportSort,
            'sort-destructure-keys': pluginSortDestructureKeys,
            'sort-keys-fix': pluginSortKeys,
            'typescript-sort-keys': pluginTypescriptSortKeys,
        },
        rules: rules,
        settings: {
            '@import/core-modules': ['bun:test'],
            '@import/parsers': {
                '@stylistic/parser': ['.js', '.mjs', '.ts', '.tsx'],
                '@typescript-eslint/parser': ['.ts', '.tsx'],
            },
            '@import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: '../../tsconfig.json',
                },
            },
            'react': { version: 'detect' },
        },
    };
    if (files)
        config.files = files;
    return config;
};
var IGNORE_PATHS = ['node_modules', '.cache', 'build', 'dist'];
export default pluginTypescript.config.apply(pluginTypescript, __spreadArray(__spreadArray(__spreadArray([{ ignores: IGNORE_PATHS.flatMap(function (path) { return ["".concat(path, "/**"), "**/".concat(path, "/**")]; }) },
    eslint.configs.recommended,
    pluginJSDoc.configs['flat/recommended-typescript']], __read(pluginTypescript.configs.strict), false), __read(pluginTypescript.configs.stylistic), false), [plugin({
        rules: {
            '@basis/no-mixed-type-imports': 'error',
            '@basis/no-object-padding': 'error',
            '@import-newlines/enforce': ['error', { items: Infinity, semi: false }],
            '@import/extensions': ['error', {
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
                }],
            '@import/no-default-export': 'error',
            '@import/no-extraneous-dependencies': 'error',
            '@import/no-unresolved': 'off',
            '@import/prefer-default-export': 'off',
            '@named-import-spacing/named-import-spacing': 'error',
            '@stylistic/array-bracket-newline': ['error', 'consistent'],
            '@stylistic/array-bracket-spacing': ['error', 'never'],
            '@stylistic/arrow-parens': ['error', 'as-needed'],
            '@stylistic/class-methods-use-this': 'off',
            '@stylistic/default-case': 'off',
            '@stylistic/eol-last': ['error', 'always'],
            '@stylistic/func-names': 'off',
            '@stylistic/js/arrow-parens': ['error', 'as-needed'],
            '@stylistic/js/arrow-spacing': ['error', { after: true, before: true }],
            '@stylistic/js/computed-property-spacing': ['error', 'never'],
            '@stylistic/js/function-call-argument-newline': ['error', 'consistent'],
            '@stylistic/js/function-paren-newline': ['error', 'multiline-arguments'],
            '@stylistic/js/implicit-arrow-linebreak': ['error', 'beside'],
            '@stylistic/js/indent': 'off',
            '@stylistic/js/jsx-quotes': ['error', 'prefer-double'],
            '@stylistic/js/linebreak-style': ['error', 'unix'],
            '@stylistic/js/multiline-comment-style': ['error', 'starred-block'],
            '@stylistic/js/new-parens': ['error', 'always'],
            '@stylistic/js/no-confusing-arrow': ['error', { allowParens: true, onlyOneSimpleParam: false }],
            '@stylistic/js/no-extra-semi': 'error',
            '@stylistic/js/no-floating-decimal': 'error',
            '@stylistic/js/no-mixed-operators': ['error', { allowSamePrecedence: true }],
            '@stylistic/js/no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
            '@stylistic/js/no-multi-spaces': ['error', { ignoreEOLComments: true }],
            '@stylistic/js/no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
            '@stylistic/js/no-trailing-spaces': 'error',
            '@stylistic/js/no-whitespace-before-property': 'error',
            '@stylistic/js/one-var-declaration-per-line': ['error', 'always'],
            '@stylistic/js/operator-linebreak': ['error', 'after', {
                    overrides: { '&': 'before', '&&': 'before', ':': 'before', '?': 'before', '|': 'before', '||': 'before' },
                }],
            '@stylistic/js/prop-types': 'off',
            '@stylistic/js/quote-props': ['error', 'consistent-as-needed'],
            '@stylistic/js/quotes': ['error', 'single', { avoidEscape: true }],
            '@stylistic/js/rest-spread-spacing': ['error', 'never'],
            '@stylistic/js/semi': ['error', 'never'],
            '@stylistic/js/semi-spacing': ['error', { after: true, before: false }],
            '@stylistic/js/semi-style': ['error', 'last'],
            '@stylistic/js/sort-imports': 'off',
            '@stylistic/js/sort-keys': 'off',
            '@stylistic/js/space-before-function-paren': 'off',
            '@stylistic/js/space-in-parens': ['error', 'never'],
            '@stylistic/js/space-unary-ops': ['error', { nonwords: false, words: true }],
            '@stylistic/js/spaced-comment': ['error', 'always', { markers: ['/'] }],
            '@stylistic/js/switch-colon-spacing': ['error', { after: true, before: false }],
            '@stylistic/js/template-curly-spacing': ['error', 'never'],
            '@stylistic/js/template-tag-spacing': ['error', 'never'],
            '@stylistic/js/wrap-iife': ['error', 'inside', { functionPrototypeMethods: false }],
            '@stylistic/js/wrap-regexp': 'off',
            '@stylistic/js/yield-star-spacing': ['error', 'before'],
            '@stylistic/jsx/indent': ['error', 2],
            '@stylistic/jsx/jsx-child-element-spacing': 'error',
            '@stylistic/jsx/jsx-closing-bracket-location': ['error', 'line-aligned'],
            '@stylistic/jsx/jsx-closing-tag-location': 'error',
            '@stylistic/jsx/jsx-curly-brace-presence': ['error', {
                    children: 'never',
                    propElementValues: 'always',
                    props: 'never',
                }],
            '@stylistic/jsx/jsx-curly-newline': ['error', { multiline: 'forbid', singleline: 'forbid' }],
            '@stylistic/jsx/jsx-curly-spacing': ['error', { when: 'never' }],
            '@stylistic/jsx/jsx-equals-spacing': ['error', 'never'],
            '@stylistic/jsx/jsx-first-prop-new-line': ['error', 'multiline-multiprop'],
            '@stylistic/jsx/jsx-function-call-newline': ['error', 'multiline'],
            '@stylistic/jsx/jsx-max-props-per-line': ['error', { maximum: { multi: 1, single: 3 } }],
            '@stylistic/jsx/jsx-newline': ['error', { allowMultilines: false, prevent: true }],
            '@stylistic/jsx/jsx-one-expression-per-line': 'off',
            '@stylistic/jsx/jsx-pascal-case': ['error', {
                    allowAllCaps: false,
                    allowLeadingUnderscore: false,
                    allowNamespace: true,
                }],
            '@stylistic/jsx/jsx-props-no-multi-spaces': 'error',
            '@stylistic/jsx/jsx-props-no-spreading': 'off',
            '@stylistic/jsx/jsx-self-closing-comp': ['error', { component: true, html: true }],
            '@stylistic/jsx/jsx-sort-props': ['error', {
                    callbacksLast: true,
                    ignoreCase: true,
                    multiline: 'last',
                    reservedFirst: ['key', 'ref'],
                    shorthandFirst: true,
                }],
            '@stylistic/jsx/jsx-tag-spacing': ['error', {
                    afterOpening: 'never',
                    beforeClosing: 'proportional-always',
                    beforeSelfClosing: 'proportional-always',
                    closingSlash: 'never',
                }],
            '@stylistic/jsx/jsx-wrap-multilines': ['error', {
                    arrow: 'parens-new-line',
                    assignment: 'parens-new-line',
                    condition: 'parens-new-line',
                    declaration: 'parens-new-line',
                    logical: 'parens-new-line',
                    prop: 'parens-new-line',
                    propertyValue: 'parens-new-line',
                    return: 'parens-new-line',
                }],
            '@stylistic/linebreak-style': 'off',
            '@stylistic/max-len': ['error', { code: 120, ignorePattern: '^import ', ignoreUrls: true, tabWidth: 2 }],
            '@stylistic/newline-per-chained-call': 'off',
            '@stylistic/no-confusing-arrow': ['error', { allowParens: true }],
            '@stylistic/no-fallthrough': 'off',
            '@stylistic/no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
            '@stylistic/no-namespace': 'off',
            '@stylistic/nonblock-statement-body-position': ['error', 'beside'],
            '@stylistic/space-in-parens': ['error', 'never'],
            '@stylistic/ts/block-spacing': ['error', 'always'],
            '@stylistic/ts/brace-style': ['error', '1tbs', { allowSingleLine: true }],
            '@stylistic/ts/class-literal-property-style': 'off',
            '@stylistic/ts/comma-dangle': ['error', 'always-multiline'],
            '@stylistic/ts/comma-spacing': ['error', { after: true, before: false }],
            '@stylistic/ts/function-call-spacing': ['error', 'never'],
            '@stylistic/ts/indent': ['error', 2, {
                    ObjectExpression: 1,
                    SwitchCase: 1,
                    ignoredNodes: ['TSTypeParameterInstantiation'],
                    offsetTernaryExpressions: true,
                }],
            '@stylistic/ts/key-spacing': ['error', { afterColon: true, beforeColon: false }],
            '@stylistic/ts/keyword-spacing': ['error', { after: true, before: true }],
            '@stylistic/ts/lines-between-class-members': 'off',
            '@stylistic/ts/member-delimiter-style': ['error', {
                    multiline: { delimiter: 'comma', requireLast: true },
                    singleline: { delimiter: 'comma', requireLast: false },
                }],
            '@stylistic/ts/no-extra-parens': 'off',
            // this rule breaks arrows that return nested expressions
            '@stylistic/ts/no-extra-semi': 'error',
            '@stylistic/ts/no-tabs': ['error', { allowIndentationTabs: false }],
            '@stylistic/ts/object-curly-newline': ['error', {
                    ExportDeclaration: { multiline: true },
                    ImportDeclaration: 'never',
                    ObjectExpression: { consistent: true, multiline: true },
                    ObjectPattern: { multiline: true },
                }],
            '@stylistic/ts/object-curly-spacing': ['error', 'always'],
            '@stylistic/ts/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
            '@stylistic/ts/quotes': ['error', 'single', { avoidEscape: true }],
            '@stylistic/ts/semi': ['error', 'never', { beforeStatementContinuationChars: 'always' }],
            '@stylistic/ts/space-before-blocks': ['error', 'always'],
            '@stylistic/ts/space-before-function-paren': ['error', {
                    anonymous: 'always',
                    asyncArrow: 'always',
                    named: 'never',
                }],
            '@stylistic/ts/space-infix-ops': ['error', { int32Hint: false }],
            '@stylistic/ts/type-annotation-spacing': ['error', {
                    after: true,
                    before: false,
                    overrides: { arrow: { after: true, before: true } },
                }],
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/class-literal-property-style': 'off',
            '@typescript-eslint/consistent-type-imports': ['error', {
                    disallowTypeAnnotations: true,
                    fixStyle: 'separate-type-imports',
                    prefer: 'type-imports',
                }],
            '@typescript-eslint/member-ordering': ['error', {
                    classes: 'never',
                    interfaces: {
                        order: 'alphabetically',
                    },
                    typeLiterals: {
                        memberTypes: ['signature', 'constructor', 'field', 'method'],
                        order: 'alphabetically',
                    },
                }],
            '@typescript-eslint/naming-convention': [
                'error',
                { format: ['PascalCase'], selector: 'enum' },
                { format: ['PascalCase'], selector: 'enumMember' },
                { format: ['PascalCase'], selector: 'typeLike' },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-import-type-side-effects': 'error',
            'arrow-body-style': ['error', 'as-needed'],
            'camelcase': ['error', { properties: 'always' }],
            'consistent-return': 'error',
            'dot-notation': 'error',
            'eol-last': ['error', 'always'],
            'function-paren-newline': ['error', 'multiline-arguments'],
            'no-console': 'error',
            'no-return-assign': 'error',
            'no-shadow': 'error',
            'no-unused-vars': 'off',
            'no-var': 'error',
            'prefer-destructuring': ['error', { AssignmentExpression: { array: false, object: false } }],
            'simple-import-sort/imports': ['error', { groups: [['^[a-z@]', '^@basis/', '^([.]+[/])+', '.s?css$']] }],
            'sort-destructure-keys/sort-destructure-keys': ['error', { caseSensitive: false }],
            'sort-keys-fix/sort-keys-fix': 'error',
            'sort-vars': ['error', { ignoreCase: true }],
            'typescript-sort-keys/interface': 'error',
            'typescript-sort-keys/string-enum': 'error',
        },
    }),
    plugin({
        files: ['*.test.ts', '*.test.tsx'],
        rules: {
            'dot-notation': 'off',
            'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
        },
    })], false));
