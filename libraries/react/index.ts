export { ApplicationBase } from './components/ApplicationBase/ApplicationBase'
export { Component } from './components/Component/Component'
export { IndexHTML } from './components/IndexHTML/IndexHTML'
export { Link } from './components/Link/Link'
export { Router } from './components/Router/Router'
export { render } from './testing/render'
export { Simulate } from './testing/Simulate'
export { waitFor } from './testing/waitFor'

declare global {
	interface ApplicationContext {}

	interface Window {
		ApplicationBase: import('./components/ApplicationBase/ApplicationBase').ApplicationBase,
		ApplicationContext: React.Context<ApplicationContext>,
	}
}
