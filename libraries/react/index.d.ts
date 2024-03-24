import type { Application } from './components/Application/Application'

declare global {
	interface ApplicationContext {}

	interface Window {
		ApplicationContext: React.Context<ApplicationContext>,
		application: Application,
	}
}