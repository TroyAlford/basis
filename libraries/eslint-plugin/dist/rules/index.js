/* eslint-disable @basis/no-default-export */
import { importExtensions } from './importExtensions.js';
import { noMixedTypeImports } from './no-mixed-type-imports.js';
import { noObjectPadding } from './no-object-padding.js';
import { noDefaultExport } from './noDefaultExport.js';
import { noExtraneousDependencies } from './noExtraneousDependencies.js';
import { noJsxLineBreaks } from './noJsxLineBreaks.js';
import { noJsxSpaceInjection } from './noJsxSpaceInjection.js';
import { sortInterface } from './sortInterface.js';
import { sortKeys } from './sortKeys.js';
import { sortStringEnum } from './sortStringEnum.js';
export default {
    rules: {
        'import-extensions': importExtensions,
        'no-default-export': noDefaultExport,
        'no-extraneous-dependencies': noExtraneousDependencies,
        'no-jsx-line-breaks': noJsxLineBreaks,
        'no-jsx-space-injection': noJsxSpaceInjection,
        'no-mixed-type-imports': noMixedTypeImports,
        'no-object-padding': noObjectPadding,
        'sort-interface': sortInterface,
        'sort-keys': sortKeys,
        'sort-string-enum': sortStringEnum,
    },
};
