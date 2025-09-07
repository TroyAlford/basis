import { css, style } from '../utilities/style'

export const PrefixSuffixStyles = style('basis:prefix-suffix', css`
  :root {
    --basis-prefix-suffix-background: #8884;
    --basis-prefix-suffix-foreground: #888F;
    --basis-prefix-suffix-border-color: #8888;
    --basis-prefix-suffix-border: 1px solid var(--basis-prefix-suffix-border-color);
  }

  [data-has-prefix] > .prefix,
  [data-has-suffix] > .suffix {
    align-items: center;
    display: flex;
    font-size: inherit;
    justify-content: center;
    line-height: inherit;
    padding: .25em;
    white-space: nowrap;

    background-color: var(--basis-prefix-suffix-background);
    border-radius: inherit;
    border: var(--basis-prefix-suffix-border);
    color: var(--basis-prefix-suffix-foreground);
  }
`)
