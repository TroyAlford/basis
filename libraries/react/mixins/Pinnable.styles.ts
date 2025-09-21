import { Pin } from '../types/Pin'
import { css, style } from '../utilities/style'

export const PinnableStyles = style('basis:pinnable', css`
  [data-pin] {
    position: sticky;

    &[data-pin="${Pin.Left}"], &[data-pin="${Pin.Right}"] {
      z-index: 1;
    }
    &[data-pin="${Pin.Left}"]:not(:has(+ [data-pin="${Pin.Left}"])) {
      border-right: 1px solid var(--basis-table-border-color);
      z-index: 1;
    }
    &[data-pin="${Pin.Right}"]:not(:is([data-pin="${Pin.Right}"] + [data-pin="${Pin.Right}"])) {
      border-left: 1px solid var(--basis-table-border-color);
    }
  }
`)
