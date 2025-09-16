import { css, style } from '../../utilities/style'

style('basis:option-group', css`
  .option-group.editor {
    display: inline-flex;
    border-radius: var(--basis-radius-sm);
    gap: 0.25em;
    padding: .25em;
    margin: 0;
    
    &[data-orientation="horizontal"] {
      align-items: center;
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: flex-start;
    }
    
    &[data-orientation="vertical"] {
      align-items: flex-start;
      flex-direction: column;
      justify-content: flex-start;
    }

    > .option-group-item {
      align-items: center;
      border-radius: var(--basis-radius-sm);
      cursor: pointer;
      display: flex;
      gap: 0.25em;
      padding: 0.25em;
      transition: background-color 0.15s ease;
      
      &:hover {
        background: var(--basis-color-background-hover);
      }
      
      &[data-disabled] {
        cursor: default;
      }
      
      > input {
        cursor: pointer;
        margin: 0;
        padding: 0;
        
        &:disabled {
          cursor: default;
        }
      }
    }
  }
`)
