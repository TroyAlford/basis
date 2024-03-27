import React from 'react'
import { deepEquals } from '@basis/utilities'
import { Component } from '../Component/Component'

type Props = {
	routes?: Iterable<[string, Component]>,
}

export class ApplicationBase<P extends object = object, S extends object = object>
	extends Component<P & Props, HTMLElement, S & { context: ApplicationContext }>
{
	static defaultProps = {
		...Component.defaultProps,
		routes: [],
	}
	Context = React.createContext<ApplicationContext>(this.defaultContext)

	get classNames() { return super.classNames.add('application') }
	get defaultContext(): ApplicationContext {
		return {} as ApplicationContext
	}
	get defaultState() {
		return {
			...super.defaultState,
			context: this.defaultContext,
		}
	}
	get tag() { return 'main' as keyof React.ReactHTML }

	constructor(props) {
		super(props)

		if (typeof window !== 'undefined') {
			window.ApplicationBase = this
			window.ApplicationContext = this.Context
		}
	}

	content(children) {
		const { Provider } = this.Context
		return (
			<Provider value={this.state.context}>
				{/* <Router routes={this.props.routes} /> */}
				{children}
			</Provider>
		)
	}

	setContext(updates: Partial<ApplicationContext>) {
		const context: ApplicationContext = { ...this.state.context, ...updates }
		if (deepEquals(this.state.context, context)) return

		this.setState(state => ({ ...state, context }))
	}
}
