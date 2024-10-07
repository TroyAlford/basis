import { noMixedTypeImports } from './no-mixed-type-imports.ts'
import { noObjectPadding } from './no-object-padding.ts'

export const plugin = {
  rules: {
    'no-mixed-type-imports': noMixedTypeImports,
    'no-object-padding': noObjectPadding,
  },
}
