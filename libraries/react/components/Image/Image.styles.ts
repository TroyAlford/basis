import { css, style } from '../../utilities/style'

style('basis:image', css`
  .image.component {
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    display: block;
    height: 100%;
    max-height: 100%;
    max-width: 100%;
    position: relative;
    width: 100%;

    /* Accessibility focus styles */
    &:focus-visible {
      outline: 2px solid var(--basis-color-focus);
      outline-offset: 2px;
    }

    /* Interactive states */
    &:hover {
      cursor: pointer;
    }
  }

  @keyframes loading {
    to { transform: translateX(-50%); }
  }
`)
