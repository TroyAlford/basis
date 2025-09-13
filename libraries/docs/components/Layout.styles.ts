import { css, style } from '@basis/react'

style('basis:docs:layout', css`
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap');

  html, body {
    background-color: var(--basis-color-background);
    color: var(--basis-color-foreground);
    font-family: 'Ubuntu', sans-serif;
    font-size: var(--basis-font-size-md);
    margin: 0;
    padding: 0;
  }

  .layout.component {
    display: grid;
    grid-template-columns: 200px 1fr;
    grid-template-areas: 'nav main';
    overflow: hidden;
    height: 100vh;
    width: 100vw;

    > nav.links {
      background: #eee;
      border-right: 1px solid #e9ecef;
      flex-shrink: 0;
      grid-area: nav;
      overflow-y: auto;
      width: 200px;

      > h1 {
        background-color: var(--basis-color-foreground);
        color: var(--basis-color-background);
        font-size: var(--basis-font-size-xxl);
        padding: var(--basis-unit-md);
        margin: 0;
      }

        UL, LI {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        LI {
          > A {
            display: block;
            padding: var(--basis-unit-sm) var(--basis-unit-md);
            text-decoration: none;
            
            &[data-active='true'] {
              background-color: var(--basis-color-background);
              color: var(--basis-color-primary);
            }
          }

          > UL > LI {
            padding-left: var(--basis-unit-md);
          }
        }
    }

    > main {
      grid-area: main;
      overflow: auto;
      padding: var(--basis-unit-md);
    }
  }
`)
