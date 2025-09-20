import { css, style } from '../utilities/style'

style('basis:popup', css`
  :root {
    --basis-popup-arrow-size: 8px;
    --basis-popup-arrow-offset: calc(var(--basis-popup-arrow-size) / 2);
    --basis-popup-offset: 0;
  }

  [data-popup='true'] {
    position: absolute;
    isolation: isolate;

    &[data-popup-arrow='true'] {
      overflow: visible;

      &::after {
        background-color: inherit;
        border-bottom-width: 0;
        border-color: inherit;
        border-left-width: 0;
        border-right-width: inherit;
        border-style: inherit;
        border-top-width: inherit;
        content: '';
        position: absolute;
        height: var(--basis-popup-arrow-size);
        width: var(--basis-popup-arrow-size);
      }

      &[data-popup-anchor-point='top'],
      &[data-popup-anchor-point='top-start'],
      &[data-popup-anchor-point='top-end'] {
        transform: translateY(calc(-1 * var(--basis-popup-arrow-size)));

        &::after {
          top: calc(100% - var(--basis-popup-arrow-offset));
          rotate: 135deg;
        }
      }

      &[data-popup-anchor-point='bottom'],
      &[data-popup-anchor-point='bottom-start'],
      &[data-popup-anchor-point='bottom-end'] {
        transform: translateY(var(--basis-popup-arrow-size));

        &::after {
          bottom: calc(100% - var(--basis-popup-arrow-offset));
          rotate: -45deg;
        }
      }

      &[data-popup-anchor-point='top']::after,
      &[data-popup-anchor-point='bottom']::after {
        left: calc(
          50% - var(--popup-shift-x) -
          (var(--basis-popup-arrow-size) / 2)
        );
      }
      &[data-popup-anchor-point='top-start']::after,
      &[data-popup-anchor-point='bottom-start']::after {
        left: calc(var(--basis-popup-arrow-size) - var(--popup-shift-x));
      }
      &[data-popup-anchor-point='top-end']::after,
      &[data-popup-anchor-point='bottom-end']::after {
        right: calc(var(--basis-popup-arrow-size) + var(--popup-shift-x));
      }

      &[data-popup-anchor-point='left'],
      &[data-popup-anchor-point='left-start'],
      &[data-popup-anchor-point='left-end'] {
        transform: translateX(calc(-1 * var(--basis-popup-arrow-size)));

        &::after {
          left: calc(100% - var(--basis-popup-arrow-offset));
          rotate: 45deg;
        }
      }

      &[data-popup-anchor-point='right'],
      &[data-popup-anchor-point='right-start'],
      &[data-popup-anchor-point='right-end'] {
        transform: translateX(var(--basis-popup-arrow-size));

        &::after {
          right: calc(100% - var(--basis-popup-arrow-offset));
          rotate: -135deg;
        }
      }

      &[data-popup-anchor-point='left']::after,
      &[data-popup-anchor-point='right']::after {
        top: calc(
          50% - var(--popup-shift-y) -
          (var(--basis-popup-arrow-size) / 2)
        );
      }
      &[data-popup-anchor-point='left-start']::after,
      &[data-popup-anchor-point='right-start']::after {
        top: var(--basis-popup-arrow-size);
      }
      &[data-popup-anchor-point='left-end']::after,
      &[data-popup-anchor-point='right-end']::after {
        bottom: var(--basis-popup-arrow-size);
      }
    }
  }
`)
