import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Separate from the application config's historical scripts/config ignores.
// The collector supplies every current engineering file explicitly and rejects
// ignored or unconfigured targets. Node ESM does not acquire CommonJS globals.
export default [
  { files: ['**/*.{js,mjs,cjs}'], ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.nodeBuiltin } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  { files: ['**/*.{ts,tsx,mts,cts}'], languageOptions: { parser: tseslint.parser, ecmaVersion: 2022,
    sourceType: 'module', globals: globals.nodeBuiltin }, rules: { ...js.configs.recommended.rules, 'no-undef': 'off' } },
  { files: ['**/*.cts'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
]
