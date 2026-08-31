import { css, style } from '../../utilities/style'

style('basis:icon', css`
  :root {
    --basis-icon-color: currentColor;
    --basis-icon-overlay-color: currentColor;
    --basis-icon-size: 1em;
  }

  svg.icon.component {
    display: inline-flex;
    fill: var(--basis-icon-color);
    height: var(--basis-icon-size, 1em);
    margin: .1em;
    stroke: var(--basis-icon-color);
    vertical-align: middle;
    width: var(--basis-icon-size, 1em);

    &.clickable {
      cursor: pointer;
    }

    > .overlay,
    &.overlay {
      --basis-icon-color: var(--basis-icon-overlay-color);
      display: unset;
      height: unset;
      margin: 0;
      overflow: visible;
      width: unset;

      &.mask {
        --basis-icon-color: #000;
        fill: #000;
        stroke: #000;

        circle, ellipse, line, path, polygon, polyline, rect {
          fill: #000;
          stroke: #000;
          stroke-width: 40;
        }
      }
    }
  }
`)
