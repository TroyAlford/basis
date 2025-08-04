import type * as React from 'react'
import type { Mixin } from '../types/Mixin'

/**
 * Applies multiple mixins to a React element.
 * @param element The React element to apply mixins to.
 * @param component The component instance with mixin props.
 * @param component.props The props of the component.
 * @param mixins Array of mixins to apply.
 * @returns The enhanced React element.
 */
export function applyMixins<T extends React.ReactElement>(
  element: T,
  component: { props: unknown },
  mixins: Mixin<unknown>[],
): T {
  // Separate pre and post mixins
  const preMixins = mixins.filter(mixin => !mixin.post)
  const postMixins = mixins.filter(mixin => mixin.post)

  // Apply pre mixins first
  let result = preMixins.reduce((currentElement, mixin) => mixin.apply(currentElement, component), element)

  // Apply post mixins last
  result = postMixins.reduce((currentElement, mixin) => mixin.apply(currentElement, component), result)

  return result
}
