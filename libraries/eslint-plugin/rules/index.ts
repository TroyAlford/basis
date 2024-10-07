/* eslint-disable @import/no-default-export */
import { noMixedTypeImports } from './no-mixed-type-imports'
import { noObjectPadding } from './no-object-padding'

export default {
  rules: {
    'no-mixed-type-imports': noMixedTypeImports,
    'no-object-padding': noObjectPadding,
  },
}
