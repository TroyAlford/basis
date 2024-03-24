import React from 'react'
import { deepEquals } from '@basis/utilities'
import { Component } from '../Component/Component'

export class Application<
	Props extends object = object,
	State extends object = object,
> extends Component<Props, State & { context: ApplicationContext }> {
	Context = React.createContext<ApplicationContext>(this.defaultContext)

	get defaultContext(): ApplicationContext {
		return {} as ApplicationContext
	}
	get defaultState() {
		return {
			...super.defaultState,
			context: this.defaultContext,
		}
	}

	get classNames() { return super.classNames.add('application') }

	constructor(props) {
		super(props)

		if (typeof window !== 'undefined') {
			window.application = this
			window.ApplicationContext = this.Context
		}
	}

	content(children) {
		const { Provider } = this.Context
		return (
			<Provider value={this.state.context}>
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
