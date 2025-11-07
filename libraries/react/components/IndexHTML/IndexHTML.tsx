import * as React from 'react'

const version = React.version
const bundle = Bun.env.NODE_ENV !== 'production'
  ? 'development'
  : 'production.min'
interface Props {
  /** An array of script URLs to add, deferred. */
  scripts: string[],
}

/**
 * Renders the HTML for the index page.
 * @param props - The component props.
 * @param props.scripts - An array of script URLs to add, deferred.
 * @returns The rendered HTML.
 */
export const IndexHTML: React.FC<Props> = ({ scripts = [] }) => (
  <html lang="en">
    <head>
      <meta charSet="UTF-8" />
      <meta content="width=device-width, initial-scale=1.0" name="viewport" />
      <link href="/assets/favicon.svg" rel="icon" type="image/svg+xml" />
      <title>Document</title>
      <script defer src={`/modules/react@${version}/umd/react.${bundle}.js`} />
      <script defer src={`/modules/react-dom@${version}/umd/react-dom.${bundle}.js`} />
      {scripts.map(script => (
        <script key={script} defer src={`/scripts/${script}`} />
      ))}
    </head>
    <body>
      {/** biome-ignore lint/correctness/useUniqueElementIds: 'root' is always unique */}
      <div id="root" />
    </body>
  </html>
)
