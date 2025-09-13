import { css, style } from '@basis/react'

export const moonPhaseDocsStyles = style('basis:docs:moonphase', css`
  .moon-phase-docs {
    .moon-phase-section {
      background-color: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      display: grid;
      gap: 24px;
      grid-template-columns: 1fr 2fr;
      margin-bottom: 32px;
      padding: 24px;

      @media (max-width: 768px) {
        grid-template-columns: 1fr;
      }
    }

    .moon-controls {
      h3 {
        margin-bottom: 16px;
        margin-top: 0;
      }
    }

    .moon-controls-grid {
      display: grid;
      gap: 16px;
      grid-template-columns: 1fr;
    }

    .control-group {
      label {
        display: block;
        font-weight: 500;
        margin-bottom: 4px;
      }
    }

    .moon-display {
      align-items: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .moon-demo-container {
      --basis-icon-size: 120px;
      background-color: white;
      border: 1px solid #dee2e6;
      border-radius: 50%;
      margin-bottom: 16px;
      padding: 20px;
    }

    .color-input {
      border: 1px solid #ced4da;
      border-radius: 4px;
      cursor: pointer;
      height: 32px;
      width: 100%;
    }

    .moon-phase-name {
      color: #6c757d;
      font-size: 14px;
      font-weight: 500;
      text-align: center;
    }
  }
`)
