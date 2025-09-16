import { css, style } from '../../utilities/style'

style('basis:section', css`
  :root {
    --basis-section-margin: 1em 0;
    --basis-section-padding: 0;
    --basis-section-gap: 1rem;
  }

  .section.component {
    display: flex;
    flex-direction: column;
    gap: var(--basis-section-gap);
    margin: var(--basis-section-margin);
    padding: var(--basis-section-padding);

    > .title {
      margin: 0;
      
      > .link {
        color: inherit;
        display: none;
        margin-left: .25em;
        opacity: .5;
      }

      &:hover {
        > .link { display: inline-block; }
      }
    }
  }
`)
