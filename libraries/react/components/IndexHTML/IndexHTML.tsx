import * as React from 'react'
import type { BasisRuntime } from '../../../utilities'
import { serializeBasisRuntime } from '../../../utilities'

interface Props {
  /**
   * Immutable runtime facts embedded for the client application context. When
   * present they are written as an escaped JSON document so the browser boots
   * without an extra fetch.
   */
  runtime?: BasisRuntime,
  /** An array of script URLs to add, deferred. */
  scripts: string[],
  /** The document title. Defaults to `Document`. */
  title?: string,
}

/**
 * Renders the HTML for the index page.
 *
 * Dependencies (including React) are bundled into the entrypoints in every
 * mode, so the shell loads only the compiled scripts and never a CDN or
 * browser-global build.
 * @param props - The component props.
 * @param props.runtime - Runtime facts embedded for the client.
 * @param props.scripts - An array of script URLs to add, deferred.
 * @param props.title - The document title.
 * @returns The rendered HTML.
 */
export const IndexHTML: React.FC<Props> = ({ runtime, scripts = [], title = 'Document' }) => (
  <html lang="en">
    <head>
      <meta charSet="UTF-8" />
      <meta content="width=device-width, initial-scale=1.0" name="viewport" />
      <link href="/assets/favicon.svg" rel="icon" type="image/svg+xml" />
      <title>{title}</title>
      {runtime && (
        /*
         * `serializeBasisRuntime` escapes `<`, `>`, and `&`, so this trusted,
         * server-controlled payload can never terminate the script element.
         */
        <script
          dangerouslySetInnerHTML={{ __html: serializeBasisRuntime(runtime) }}
          id="basis-runtime"
          type="application/json"
        />
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
