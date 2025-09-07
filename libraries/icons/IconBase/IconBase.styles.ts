import { css, style } from '@basis/react'

style('basis:icon', css`
  :root {
    --basis-icon-color: currentColor;
    --basis-icon-overlay-color: currentColor;
    --basis-icon-overlay-stroke: currentColor;
    --basis-icon-size: 1em;
    --basis-icon-stroke: currentColor;
  }

  svg.icon.component {
    display: inline-flex;
    fill: var(--basis-icon-color);
    height: var(--basis-icon-size, 1em);
    margin: .1em;
    stroke: var(--basis-icon-stroke);
    vertical-align: middle;
    width: var(--basis-icon-size, 1em);

    &.clickable {
      cursor: pointer;
    }

    > .overlay {
      fill: var(--basis-icon-overlay-color);
      stroke: var(--basis-icon-overlay-stroke);
    }
  }
`)
