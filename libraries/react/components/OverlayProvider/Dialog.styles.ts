import { Intent } from '@basis/react/types/Intent'
import { css, style } from '../../utilities/style'

style('basis:dialog', css`
  .dialog.component {
    background-color: var(--basis-color-background);
    border: 1px solid var(--basis-color-foreground);
    border-radius: 0.5em;
    color: var(--basis-color-foreground);
    display: flex;
    flex-direction: column;
    gap: .5em;
    overflow: hidden;
    padding: 0;

    > header {
      align-items: center;
      background-color: var(--basis-color-foreground);
      color: var(--basis-color-background);
      display: flex;
      flex-wrap: wrap;
      font-size: var(--basis-font-size-lg);
      font-weight: bold;
      gap: 0.35em;
      margin: -1px -1px 0;
      padding: .5em;
    }

    > section {
      overflow: auto;
      padding: .5em;
    }

    > footer {
      display: flex;
      gap: .25em;
      justify-content: flex-end;
      padding: .5em;
    }

    &[data-intent="${Intent.Danger}"] {
      border-color: var(--basis-color-danger);

      > header {
        background-color: var(--basis-color-danger);
        color: var(--basis-color-danger-contrast);
      }
    }
    &[data-intent="${Intent.Primary}"] {
      border-color: var(--basis-color-primary);

      > header {
        background-color: var(--basis-color-primary);
        color: var(--basis-color-contrast);
      }
    }
    &[data-intent="${Intent.Success}"] {
      border-color: var(--basis-color-success);

      > header {
        background-color: var(--basis-color-success);
        color: var(--basis-color-success-contrast);
      }
    }
  }
`)
