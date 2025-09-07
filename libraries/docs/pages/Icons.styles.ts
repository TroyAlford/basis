import { css, style } from '@basis/react'

export const iconsDocsStyles = style('basis:docs:icons', css`
  .icon-demo-container {
    --basis-icon-color: var(--demo-icon-color, currentColor);
    --basis-icon-stroke: var(--demo-icon-color, currentColor);
    --basis-icon-size: var(--demo-icon-size, 1em);
  }
  .icons-docs {
    .controls-grid {
      background-color: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      margin-bottom: 24px;
      padding: 16px;
    }

    .control-group {
      label {
        display: block;
        font-weight: 500;
        margin-bottom: 4px;
      }
    }

    .color-input {
      border: 1px solid #ced4da;
      border-radius: 4px;
      cursor: pointer;
      height: 32px;
      width: 100%;
    }

    .icon-grid {
      background-color: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      padding: 16px;
    }

    .icon-item {
      align-items: center;
      background-color: white;
      border: 1px solid #dee2e6;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      padding: 12px;
      transition: all 0.2s ease;

      > .icon-demo-container {
        background-color: #ccc;
      }

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      }
    }

    .icon-name {
      color: #6c757d;
      font-size: 12px;
      margin-top: 8px;
      text-align: center;
      word-break: break-word;
    }

    .special-icons-grid {
      background-color: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      padding: 16px;
    }

    .special-icon-item {
      align-items: center;
      background-color: white;
      border: 1px solid #dee2e6;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      padding: 12px;
    }

    .special-icon-name {
      color: #6c757d;
      font-size: 12px;
      margin-top: 8px;
      text-align: center;
    }

    .moon-controls-grid {
      background-color: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      margin-bottom: 24px;
      padding: 16px;
    }

  }
`)
