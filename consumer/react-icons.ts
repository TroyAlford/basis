/**
 * Consumer-facing entrypoint for the Basis icon set.
 *
 * `basis/react` exports the icons too, but a few icon names collide with
 * component names (for example the `Table` icon and the `Table` component), so
 * the component wins there. This subpath exposes the icons on their own, so a
 * consumer can `import { Table } from 'basis/react/icons'`.
 */
export * from '../libraries/react/icons'
