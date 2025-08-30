import { css, style } from '../../utilities/style'

style('basis:text-editor', css`
  .text-editor.component {
    line-height: 1em;
    min-height: 1.5em;
    padding: .25em;
    position: relative;

    > .value { resize: none; }
    &::before { padding: 0; }

    > .value, &::before {
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      margin: 0;
      white-space: pre-wrap;
    }

    &[data-multiline="true"] {
      > .value {
        display: flex;
        overflow: auto;
      }
    }

    &[data-multiline="auto"] {
      &::before {
        content: attr(data-value) ' ';
        inset: 1px; // account for the border
        visibility: hidden;
      }

      > .value {
        inset: 0;
        overflow: hidden;
        padding: inherit;
        position: absolute;
      }
    }
  }
`)
