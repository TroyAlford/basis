import { css, style } from '../../utilities/style'

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

    > .overlay,
    &.overlay {
      --basis-icon-color: var(--basis-icon-overlay-color);
      --basis-icon-stroke: var(--basis-icon-overlay-stroke);
      display: unset;
      fill: var(--basis-icon-overlay-color);
      height: unset;
      margin: 0;
      overflow: visible;
      stroke: var(--basis-icon-overlay-stroke);
      width: unset;
    }
  }
`)
