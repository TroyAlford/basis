import { css, style } from '../utilities/style'

import.meta.hot.accept()

style('basis:prefix-suffix', css`
  [data-has-prefix] > .prefix,
  [data-has-suffix] > .suffix {
    align-items: center;
    align-self: stretch;
    background-color: var(--basis-prefix-suffix-background, var(--basis-color-surface-inset));
    border-color: var(--basis-prefix-suffix-border-color, var(--basis-color-border-subtle));
    color: var(--basis-prefix-suffix-foreground, var(--basis-color-foreground-muted));
    display: flex;
    font-size: inherit;
    justify-content: center;
    line-height: inherit;
    padding: .25em;
    white-space: nowrap;
  }

  [data-has-prefix] > .prefix {
    border-right:
      var(--basis-prefix-suffix-border,
        1px solid var(--basis-prefix-suffix-border-color, var(--basis-color-border-subtle)));
  }

  [data-has-suffix] > .suffix {
    border-left:
      var(--basis-prefix-suffix-border,
        1px solid var(--basis-prefix-suffix-border-color, var(--basis-color-border-subtle)));
  }
`)
