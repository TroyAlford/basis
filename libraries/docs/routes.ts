import { AwaitDocs } from './pages/Await.docs.tsx'
import { ButtonDocs } from './pages/Button.docs.tsx'
import { OverviewDocs } from './pages/Overview.docs.tsx'
import { RouterDocs } from './pages/Router.docs.tsx'

export interface DocRoute {
  /** The component to render */
  component: React.ComponentType,
  /** Whether this is the default/home page */
  default?: boolean,
  /** The path for the route */
  path: string,
  /** The title to display in navigation */
  title: string,
}

export const routes: DocRoute[] = [{
  component: OverviewDocs,
  default: true,
  path: '/',
  title: 'Overview',
}, {
  component: AwaitDocs,
  path: '/components/await',
  title: 'Await',
}, {
  component: ButtonDocs,
  path: '/components/button',
  title: 'Button',
}, {
  component: RouterDocs,
  path: '/components/router',
  title: 'Router',
}].sort((a, b) => {
  if (a.default) return -1
  if (b.default) return 1
  return a.title.localeCompare(b.title)
})

export const defaultRoute = routes.find(route => route.default) || routes[0]
