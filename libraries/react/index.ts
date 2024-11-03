import type { ApplicationBase } from './components/ApplicationBase/ApplicationBase'

export * from './components'
export { render } from './testing/render'
export { Simulate } from './testing/Simulate'
export { waitFor } from './testing/waitFor'

declare global {
  type ApplicationContext = Record<string, unknown>

  interface Window {
    ApplicationBase: ApplicationBase,
    ApplicationContext: React.Context<ApplicationContext>,
  }
}
