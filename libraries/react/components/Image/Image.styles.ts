import { css, style } from '../../utilities/style'

style('basis:image', css`
  .image.component {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    min-height: 100px;
    min-width: 100px;
    background-repeat: no-repeat;

    /* Size behaviors */
    &[data-size="natural"] {
      width: auto;
      height: auto;
      min-width: auto;
      min-height: auto;
    }

    &[data-size="contain"] {
      background-size: contain !important;
    }

    &[data-size="fill"] {
      background-size: cover !important;
    }

    /* Loading state */
    &[data-loading="true"] {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: loading 1.5s infinite;
    }

    /* Error state */
    &[data-error="true"] {
      background: #f44336 !important;
      background-size: contain !important;
      background-repeat: no-repeat !important;
      background-position: center !important;
    }

    /* Loaded state - set background image */
    &[data-loaded="true"][data-src] {
      background-image: url(attr(data-src url));
    }

    /* Alignment styles */
    &[data-align="center"] { background-position: center; }
    &[data-align="n"] { background-position: center top; }
    &[data-align="s"] { background-position: center bottom; }
    &[data-align="e"] { background-position: right center; }
    &[data-align="w"] { background-position: left center; }
    &[data-align="ne"] { background-position: right top; }
    &[data-align="nw"] { background-position: left top; }
    &[data-align="se"] { background-position: right bottom; }
    &[data-align="sw"] { background-position: left bottom; }

    /* Accessibility focus styles */
    &:focus-visible {
      outline: 2px solid #007acc;
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
