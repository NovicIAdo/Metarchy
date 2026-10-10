import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // android/ is the generated Capacitor project (Gradle + copied web assets).
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.gen.ts', 'apps/client/android/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
)
