module.exports = { // eslint-disable-line
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/eslint-recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:react/recommended',
	],
	parserOptions: {
		project: true,
	},
	plugins: [
		'import-newlines',
		'import',
		'jsdoc',
		'react',
		'sort-keys-fix',
	],
	settings: {
		'import/core-modules': ['bun:test'],
		'import/parsers': {
			'@typescript-eslint/parser': ['.ts', '.tsx'],
		},
		'import/resolver': {
			typescript: {},
		},
		react: { version: 'detect' },
	},

	rules: { // eslint-disable-line sort-keys-fix/sort-keys-fix
		'@typescript-eslint/indent': ['error', 'tab', { SwitchCase: 1 }],
		'@typescript-eslint/member-delimiter-style': ['error', {
			multiline: { delimiter: 'comma', requireLast: true },
			singleline: { delimiter: 'comma', requireLast: false },
		}],
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
		'@typescript-eslint/no-namespace': 'off',
		'@typescript-eslint/no-shadow': 'error',
		'@typescript-eslint/no-unused-vars': 'error',
		'array-bracket-newline': ['error', 'consistent'],
		'arrow-parens': ['error', 'as-needed'],
		'class-methods-use-this': 'off',
		'comma-dangle': ['error', 'always-multiline'],
		'consistent-return': 'error',
		'default-case': 'off',
		'func-names': 'off',
		'import-newlines/enforce': ['error', { items: Infinity, semi: false }],
		'import/extensions': ['error', {
			css: 'always',
			jpg: 'always',
			js: 'never',
			json: 'always',
			png: 'always',
			scss: 'always',
			svg: 'always',
			ts: 'never',
			tsx: 'never',
		}],
		'import/no-default-export': 'error',
		'import/no-extraneous-dependencies': 'error',
		'import/no-unresolved': 'off', // use TS version
		'import/order': ['error', {
			'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
			'newlines-between': 'never',
		}],
		'import/prefer-default-export': 'off',
		'indent': 'off',
		'linebreak-style': 'off',
		'lines-between-class-members': 'off',
		'max-len': ['error', { code: 120, ignorePattern: '^import ', ignoreUrls: true, tabWidth: 2 }],
		'newline-per-chained-call': 'off',
		'no-confusing-arrow': ['error', { allowParens: true }],
		'no-console': 'error',
		'no-fallthrough': 'off',
		'no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
		'no-trailing-spaces': 'error',
		'no-var': 'error',
		'prefer-destructuring': ['error', { AssignmentExpression: { array: false, object: false } }],
		'quotes': ['error', 'single', { avoidEscape: true }],
		'react/jsx-indent': ['error', 'tab', { checkAttributes: true, indentLogicalExpressions: true }],
		'react/jsx-indent-props': ['error', 'tab'],
		'react/jsx-max-props-per-line': 'off',
		'react/jsx-props-no-spreading': 'off',
		'react/jsx-sort-props': ['error', {
			callbacksLast: true,
			ignoreCase: true,
			reservedFirst: ['key', 'ref'],
			shorthandFirst: true,
		}],
		'react/prop-types': 'off',
		'semi': ['error', 'never'],
		'semi-style': 'off',
		'sort-imports': 'off',
		'sort-keys': 'off',
		'sort-keys-fix/sort-keys-fix': 'error',
		'sort-vars': ['error', { ignoreCase: true }],
		'spaced-comment': ['error', 'always', { markers: ['/'] }],
	},

	overrides: [ // eslint-disable-line sort-keys-fix/sort-keys-fix
		{
			files: ['*.test.ts', '*.test.tsx'],
			rules: {
				'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
			},
		},
	],
}