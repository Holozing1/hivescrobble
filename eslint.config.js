import solid from '@web-scrobbler/eslint-config/solid.js';

export default [
	...solid,
	{
		ignores: ['build/**', 'node_modules/**', 'src/vendor/**', '.xcode/**'],
	},
	{
		// Hobbles fork overrides — relax a few opinionated rules that flag
		// idiomatic or contract-required code (no behaviour change):
		//   - eqeqeq null:ignore  → keep idiomatic `x != null` loose checks
		//     (which intentionally catch undefined too).
		//   - camelcase           → allow snake_case object props + destructured
		//     bindings, required by Hive custom_json payload fields (now_playing).
		//   - no-unused-vars ^_   → `_`-prefixed params are intentional interface
		//     stubs (the Hive scrobbler can't implement love / now-playing).
		//   - no-nested-ternary   → off; used in payload-shaping logic.
		rules: {
			eqeqeq: ['error', 'always', { null: 'ignore' }],
			camelcase: [
				'error',
				{ properties: 'never', ignoreDestructuring: true },
			],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
			'no-nested-ternary': 'off',
		},
	},
];
