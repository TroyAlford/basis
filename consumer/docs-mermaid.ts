/**
 * Consumer-facing entrypoint for the docs Mermaid component.
 *
 * Basis's Markdown/MDX docs setup injects this component for `mermaid` fences,
 * so a documentation consumer does not need to import it or configure it. The
 * component stays out of the application `basis/react` barrel.
 */
export { Mermaid } from '../libraries/docs/components/Mermaid/Mermaid'
