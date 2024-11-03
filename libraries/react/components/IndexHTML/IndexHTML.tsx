import React from 'react'

const version = React.version
const bundle = Bun.env.NODE_ENV !== 'production'
  ? 'development'
  : 'production.min'

export const IndexHTML = () => (
  <html lang="en">
    <head>
      <meta charSet="UTF-8" />
      <meta content="width=device-width, initial-scale=1.0" name="viewport" />
      <link href="/assets/favicon.svg" rel="icon" type="image/svg+xml" />
      <title>Document</title>
      <script defer src={`/modules/react@${version}/umd/react.${bundle}.js`} />
      <script defer src={`/modules/react-dom@${version}/umd/react-dom.${bundle}.js`} />
      <script defer src="/scripts/index.js" />
    </head>
    <body>
      <div id="root" />
    </body>
  </html>
)
