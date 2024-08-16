import eslintPlugin from './libraries/eslint-plugin/index.mjs'

export default [
	...eslintPlugin,
	{
		files: ['**/*.js', '**/*.mjs', '**/*.ts', '**/*.tsx'],
		ignores: ['**/node_modules/**'],
	},
]
