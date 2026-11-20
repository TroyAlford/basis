import * as React from 'react'
import type { BasisRuntime } from '../../../utilities'
import { serializeBasisRuntime } from '../../../utilities'
import { Component } from '../Component/Component'

/** An explicit script source, for a shell whose scripts are not served names. */
export interface ScriptSource {
  /** Load as an ES module rather than a deferred classic script. */
  module?: boolean,
  /** The script URL, used as-is. */
  src: string,
}

interface Props {
  /**
   * Whether to render the standard favicon link. The link always points at
   * `/assets/favicon`, the extensionless URL every Basis server serves;
   * development omits it here and injects it, because Bun's HTML bundler would
   * try to bundle a linked asset. Defaults to `true`.
   */
  favicon?: boolean,
  /**
   * Classic-script URLs to load before the application entrypoints.
   *
   * They are written into a blocking inline loader so Bun's HTML bundler never
   * treats prebuilt vendor URLs as bundle entrypoints.
   */
  preScripts?: readonly string[],
  /**
   * Immutable runtime facts embedded for the client application context. When
   * present they are written as an escaped JSON document so the browser boots
   * without an extra fetch.
   */
  runtime?: BasisRuntime,
  /**
   * Scripts to load. A string is a production entrypoint name served from
   * `/scripts/`; a {@link ScriptSource} is used exactly as given, which is how
   * development loads module sources directly from Bun's dev server.
   */
  scripts: (string | ScriptSource)[],
  /** The document title. Defaults to `Document`. */
  title?: string,
}

/**
 * Renders the HTML for the index page.
 *
 * Dependencies (including React) are bundled into the entrypoints in every
 * mode, so the shell loads only the compiled scripts and never a CDN or
 * browser-global build.
 */
export class IndexHTML extends Component<Props> {
  static displayName = 'IndexHTML'

  override render(): React.ReactNode {
    const { favicon = true, preScripts = [], runtime, scripts = [], title = 'Document' } = this.props

    return (
      <html lang="en">
        <head>
          <meta charSet="UTF-8" />
          <meta content="width=device-width, initial-scale=1.0" name="viewport" />
          {favicon && <link href="/assets/favicon" rel="icon" />}
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
          {preScripts.length > 0 && (
            <script
              dangerouslySetInnerHTML={{
                __html: preScripts
                  .map(src => `document.write('<script src="${src}"><\\/script>');`)
                  .join(''),
              }}
            />
          )}
          {scripts.map(script => {
            const source = typeof script === 'string' ? { src: `/scripts/${script}` } : script
            return source.module
              ? <script key={source.src} src={source.src} type="module" />
              : <script key={source.src} defer src={source.src} />
          })}
        </head>
        <body>
          {/** biome-ignore lint/correctness/useUniqueElementIds: 'root' is always unique */}
          <div id="root" />
        </body>
      </html>
    )
  }
}
