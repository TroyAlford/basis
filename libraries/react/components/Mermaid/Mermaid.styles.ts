import { css, style } from '../../utilities/style'

style('basis:mermaid', css`
  .mermaid-diagram.component {
    background: var(--basis-color-background);
    border: 1px solid var(--basis-color-disabled);
    border-radius: var(--basis-radius-md);
    box-shadow: var(--basis-shadow-sm);
    margin: var(--basis-unit-md) 0;
    overflow-x: auto;
    padding: var(--basis-unit-md);
    text-align: center;

    svg {
      display: block;
      height: auto;
      margin: 0 auto;
      max-width: 100%;
    }

    .node rect,
    .er.entityBox,
    .cluster rect {
      rx: var(--basis-radius-sm);
      ry: var(--basis-radius-sm);
    }

    pre.mermaid {
      background: none;
      color: var(--basis-color-disabled-text);
      font-family: 'Fira Code', monospace;
      font-size: var(--basis-font-size-sm);
      margin: 0;
      text-align: left;
      white-space: pre-wrap;
    }

    &[data-variant='dark'] {
      background: var(--basis-color-foreground);
      border-color: var(--basis-color-foreground);

      pre.mermaid {
        color: var(--basis-color-background);
      }
    }
  }
`)
