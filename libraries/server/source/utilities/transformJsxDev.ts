import generate from '@babel/generator'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'

/**
 * Transforms JSX development runtime calls into standard React.createElement calls
 * @param sourceCode - The source code to transform
 * @returns The transformed source code
 */
export function transformJsxDev(sourceCode: string): string {
  const ast = parse(sourceCode, {
    plugins: ['jsx', 'typescript'],
    sourceType: 'module',
  })

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee
      if (t.isMemberExpression(callee)) {
        const object = callee.object
        const property = callee.property

        if (
          t.isIdentifier(object)
          && object.name.match(/^jsx_dev_runtime\d*$/)
          && t.isIdentifier(property)
          && property.name === 'jsxDEV'
        ) {
          const [type, props] = path.node.arguments

          const newCallee = t.memberExpression(
            t.identifier('React'),
            t.identifier('createElement'),
          )

          path.replaceWith(
            t.callExpression(newCallee, [type, props]),
          )
        }
      }
    },
    MemberExpression(path) {
      const { object, property } = path.node
      if (
        t.isIdentifier(object)
        && object.name.match(/^jsx_dev_runtime\d*$/)
        && t.isIdentifier(property)
      ) {
        if (property.name === 'Fragment') {
          path.replaceWith(
            t.memberExpression(
              t.identifier('React'),
              t.identifier('Fragment'),
            ),
          )
        }
      }
    },
  })

  const output = generate(ast, {
    compact: true,
    retainLines: true,
  }).code

  // Remove trailing semicolons and normalize whitespace
  return output
}
