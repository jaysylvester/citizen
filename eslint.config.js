import globals from 'globals'
import pluginJs from '@eslint/js'


export default [
  {
    languageOptions: {
      globals: {
        ...globals.node,
        CTZN: 'writeable'
      }
    },
    ignorePatterns: ['util/']
  },
  pluginJs.configs.recommended,
  {
    rules: {
      'linebreak-style': [
        'error',
        'unix'
      ],
      quotes: [
        'error',
        'single'
      ],
      semi: [
        'error',
        'never'
      ],
      'no-console': 0,
      'no-debugger': 0
    }
  }
]
