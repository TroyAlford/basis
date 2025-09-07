import { css, style } from '../../utilities/style'

style('basis:dropdown-menu', css`
  .dropdown-menu.component {
    display: inline-block;

    > .popup-menu.component {
      min-width: 200px;
    }
  }
`)
