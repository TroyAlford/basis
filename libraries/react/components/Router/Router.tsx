import * as React from 'react'
import { parseTemplateURI, parseURI } from '@basis/utilities'

import './history'

interface Props {
	children: React.ReactNode,
}

interface RouteProps<P = object> {
	children: (params: P) => React.ReactNode,
	template: string,
}

interface State {
	currentURL: string,
}

export class Router extends React.Component<Props, State> {
	static Route = class Route<P> extends React.Component<RouteProps<P>> { }

	get currentURL() { return parseURI(window.location.toString()).toString() }

	componentDidMount(): void {
		window.addEventListener('history', this.#handleNavigate)
	}
	componentWillUnmount(): void {
		window.removeEventListener('history', this.#handleNavigate)
	}

	#handleNavigate = () => this.forceUpdate()

	#renderRoute = () => {
		const { currentURL } = this
		const route = React.Children.toArray(this.props.children).find(child => {
			if (!React.isValidElement(child) || child.type !== Router.Route) return false
			return !!parseTemplateURI(currentURL, child.props.template)
		}) as { props: RouteProps<unknown> }

		if (route) {
			const { children, template } = route.props
			const params = parseTemplateURI(currentURL, template)

			if (typeof children === 'function') return children(params)
			if (React.isValidElement(children)) return children
		}

		return null
	}

	render = () => (
		<React.Fragment key={this.currentURL ?? 'null'}>
			{this.#renderRoute()}
		</React.Fragment>
	)
}
