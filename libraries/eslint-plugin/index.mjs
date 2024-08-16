import eslint from '@eslint/js'
import pluginStylistic from '@stylistic/eslint-plugin'
import pluginImport from 'eslint-plugin-import'
import pluginImportNewlines from 'eslint-plugin-import-newlines'
import pluginJSDoc from 'eslint-plugin-jsdoc'
import pluginNamedImportSpacing from 'eslint-plugin-named-import-spacing'
import pluginImportSort from 'eslint-plugin-simple-import-sort'
import pluginSortKeys from 'eslint-plugin-sort-keys-fix'
import pluginTypescript from 'typescript-eslint'

export default pluginTypescript.config(
	eslint.configs.recommended,
	...pluginTypescript.configs.strict,
	...pluginTypescript.configs.stylistic,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
		},
		plugins: {
			'@stylistic': pluginStylistic,
			'@typescript-eslint': pluginTypescript.plugin,
			'import': pluginImport,
			'import-newlines': pluginImportNewlines,
			'jsdoc': pluginJSDoc,
			'named-import-spacing': pluginNamedImportSpacing,
			'simple-import-sort': pluginImportSort,
			'sort-keys-fix': pluginSortKeys,
		},
		rules: {
			'@stylistic/array-bracket-newline': ['error', 'consistent'],
			'@stylistic/arrow-parens': ['error', 'as-needed'],
			'@stylistic/class-methods-use-this': 'off',
			'@stylistic/comma-dangle': ['error', 'always-multiline'],
			'@stylistic/default-case': 'off',
			'@stylistic/eol-last': ['error', 'always'],
			'@stylistic/func-names': 'off',
			'@stylistic/indent': ['error', 'tab', { SwitchCase: 1 }],
			'@stylistic/jsx-indent': ['error', 'tab', { checkAttributes: true, indentLogicalExpressions: true }],
			'@stylistic/jsx-indent-props': ['error', 'tab'],
			'@stylistic/jsx-max-props-per-line': 'off',
			'@stylistic/jsx-props-no-spreading': 'off',
			'@stylistic/jsx-sort-props': ['error', {
				callbacksLast: true,
				ignoreCase: true,
				reservedFirst: ['key', 'ref'],
				shorthandFirst: true,
			}],
			'@stylistic/linebreak-style': 'off',
			'@stylistic/lines-between-class-members': 'off',
			'@stylistic/max-len': ['error', { code: 120, ignorePattern: '^import ', ignoreUrls: true, tabWidth: 2 }],
			'@stylistic/member-delimiter-style': ['error', {
				multiline: { delimiter: 'comma', requireLast: true },
				singleline: { delimiter: 'comma', requireLast: false },
			}],
			'@stylistic/newline-per-chained-call': 'off',
			'@stylistic/no-confusing-arrow': ['error', { allowParens: true }],
			'@stylistic/no-extra-semi': 'error',
			'@stylistic/no-fallthrough': 'off',
			'@stylistic/no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
			'@stylistic/no-namespace': 'off',
			'@stylistic/space-in-parens': ['error', 'never'],
			'@typescript-eslint/class-literal-property-style': 'off',
			'@typescript-eslint/member-ordering': ['error', {
				classes: 'never',
				interfaces: {
					memberTypes: ['signature', 'constructor', 'field', 'method'],
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
			'camelcase': ['error', {
				properties: 'always',
			}],
			'consistent-return': 'error',
			'eol-last': ['error', 'always'],
			'import-newlines/enforce': ['error', { items: Infinity, semi: false }],
			'import/extensions': ['error', {
				css: 'always',
				jpg: 'always',
				js: 'never',
				json: 'always',
				png: 'always',
				scss: 'always',
				sql: 'always',
				svg: 'always',
				ts: 'never',
				tsx: 'never',
			}],
			'import/no-default-export': 'error',
			'import/no-extraneous-dependencies': 'error',
			'import/no-unresolved': 'off',
			'import/prefer-default-export': 'off',
			'named-import-spacing/named-import-spacing': 'error',
			'no-console': 'error',
			'no-shadow': 'error',
			'no-trailing-spaces': 'error',
			'no-unused-vars': 'error',
			'no-var': 'error',
			'prefer-destructuring': ['error', { AssignmentExpression: { array: false, object: false } }],
			'prop-types': 'off',
			'quotes': ['error', 'single', { avoidEscape: true }],
			'semi': ['error', 'never'],
			'semi-style': 'off',
			'simple-import-sort/imports': ['error', {
				groups: [['^[a-z@]', '^@basis/', '^([.]+[/])+', '.s?css$']],
			}],
			'sort-imports': 'off',
			'sort-keys': 'off',
			'sort-keys-fix/sort-keys-fix': 'error',
			'sort-vars': ['error', { ignoreCase: true }],
			'space-before-function-paren': ['error', {
				anonymous: 'never',
				asyncArrow: 'always',
				named: 'never',
			}],
			'spaced-comment': ['error', 'always', { markers: ['/'] }],
		},
		settings: {
			'import/core-modules': ['bun:test'],
			'import/parsers': {
				'@stylistic/parser': ['.js', '.mjs', '.ts', '.tsx'],
				'@typescript-eslint/parser': ['.ts', '.tsx'],
			},
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true,
					project: '../../tsconfig.json',
				},
			},
			react: { version: 'detect' },
		},
	}, {
		files: ['*.test.ts', '*.test.tsx'],
		rules: {
			'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
		},
	},
)
