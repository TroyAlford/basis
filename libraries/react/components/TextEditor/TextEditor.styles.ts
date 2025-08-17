import { css, style } from '../../utilities/style'

style('basis:text-editor', css`
  .text-editor.component {
    position: relative;

    > .value { resize: none; }
    &::before { padding: 0; }

    > .value, &::before {
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
