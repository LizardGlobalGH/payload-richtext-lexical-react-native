import payloadEsLintConfig from '@payloadcms/eslint-config'
import payloadPlugin from '@payloadcms/eslint-plugin'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...payloadEsLintConfig,
  {
    ignores: [
      '**/.temp',
      '**/.*',
      '**/.git',
      '**/tsconfig.tsbuildinfo',
      '**/dist/',
      '**/build/',
      '**/node_modules/',
      'src/**/*.spec.ts',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    plugins: {
      payload: payloadPlugin,
    },
    rules: {
      'payload/no-jsx-import-statements': 'warn',
      'payload/no-imports-from-exports-dir': 'error',
      'payload/no-imports-from-self': 'error',
      'payload/proper-payload-logger-usage': 'error',
    },
  },
]
