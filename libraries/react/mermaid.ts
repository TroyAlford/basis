/**
 * Internal entrypoint for the opt-in Mermaid diagram component.
 *
 * The consumer surface is `basis/react/mermaid`. Keeping Mermaid out of the
 * main `basis/react` barrel means an application that never renders a diagram
 * does not bundle `beautiful-mermaid` or its `elkjs` layout engine.
 */
export { Mermaid } from './components/Mermaid/Mermaid'
