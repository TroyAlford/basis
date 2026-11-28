import { Layout } from './components/Layout.tsx'

/*
 * Server-rendered application entrypoint. The legacy `App.tsx` bootstrap stays
 * as the static `index.html` client entry; the Basis server owns mounting and
 * hydration through its generated entry, so this module only exposes the
 * component.
 */
export const Application = Layout
