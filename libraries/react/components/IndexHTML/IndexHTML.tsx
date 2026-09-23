import * as React from 'react'

const version = React.version
const bundle = Bun.env.NODE_ENV !== 'production'
  ? 'development'
  : 'production.min'
interface Props {
  /**
   * Whether to load the React/ReactDOM UMD globals the development build
   * expects. Production bundles React, so it omits these. Defaults to `true`.
   */
  development?: boolean,
  /** An array of script URLs to add, deferred. */
  scripts: string[],
}

/**
 * Renders the HTML for the index page.
 * @param props - The component props.
 * @param props.development - Whether to load the development UMD globals.
 * @param props.scripts - An array of script URLs to add, deferred.
 * @returns The rendered HTML.
 */
export const IndexHTML: React.FC<Props> = ({ development = true, scripts = [] }) => (
  <html lang="en">
    <head>
      <meta charSet="UTF-8" />
      <meta content="width=device-width, initial-scale=1.0" name="viewport" />
      <link href="/assets/favicon.svg" rel="icon" type="image/svg+xml" />
      <title>Document</title>
      {development && (
        <>
          <script defer src={`/modules/react@${version}/umd/react.${bundle}.js`} />
          <script defer src={`/modules/react-dom@${version}/umd/react-dom.${bundle}.js`} />
        </>
      )}
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
