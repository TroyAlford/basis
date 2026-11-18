import * as React from 'react'

interface Props {
  greeting: string,
}

/** Fixture proving request context reaches the server-rendered application. */
export const Application = ({ greeting }: Props): React.ReactNode => (
  <main data-testid="context-application">{greeting}</main>
)
