import * as React from 'react'

/**
 * Minimal application fixture used by the application-level testing lane.
 * @returns The application markup.
 */
export const Application = (): React.ReactNode => React.createElement(
  React.Fragment,
  null,
  React.createElement('header', null, React.createElement('h1', null, 'Application')),
  React.createElement(
    'main',
    null,
    React.createElement('div', {
      'data-testid': 'swatch',
      'style': { background: '#137cbd', height: 32, width: 32 },
    }),
  ),
)
