/**
 * Consumer-facing entrypoint for the opt-in Basis Mermaid component.
 *
 * `Mermaid` is deliberately not part of the `basis/react` barrel: importing the
 * barrel must not pull in `beautiful-mermaid`/`elkjs` for applications that never
 * render a diagram. The component remains synchronous and SSR-capable.
 */
export { Mermaid } from '../libraries/react/mermaid'
