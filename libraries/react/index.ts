export { Application } from './components/Application/Application'
export { Component } from './components/Component/Component'
export { IndexHTML } from './components/IndexHTML/IndexHTML'
export { Router } from './components/Router/Router'
export { render } from './testing/render'
export { Simulate } from './testing/Simulate'
export { waitFor } from './testing/waitFor'

declare global {
	interface ApplicationContext {}

	interface Window {
		ApplicationContext: React.Context<ApplicationContext>,
		application: import('./components/Application/Application').Application,
	}
}