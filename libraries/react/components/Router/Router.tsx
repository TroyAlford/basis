import { parseTemplateURI } from '@basis/utilities'
import * as React from 'react'

type Props = {
	children: React.ReactNode,
}

type RouteProps<P> = {
	component?: (
		| React.ReactNode
		| React.ComponentType<P>
	),
	render?: (params: Record<string, string>) => React.ReactNode,
	template: string,
}
type State = {
	currentURL: string,
}

export class Router extends React.Component<Props, State> {
	static Route = class Route<P> extends React.Component<RouteProps<P>> {}

	state = { currentURL: window.location.pathname }

	componentDidMount = () => window.addEventListener('popstate', this.#handlePopState)
	componentWillUnmount = () => window.removeEventListener('popstate', this.#handlePopState)

	#handlePopState = () => this.setState({ currentURL: window.location.pathname })

	#renderRoute = () => {
		const { currentURL } = this.state
		const route = React.Children.toArray(this.props.children).find(child => {
			if (!React.isValidElement(child) || child.type !== Router.Route) return false
			return !!parseTemplateURI(currentURL, child.props.template)
		}) as { props: RouteProps<unknown> }
		if (!route) return null

		const { component, render, template } = route.props
		const uri = parseTemplateURI(currentURL, template)

		if (React.isValidElement(component)) {
			return React.cloneElement(component, { ...component.props, ...uri })
		} else if (typeof component === 'function') {
			return React.createElement(component, uri)
		} else if (typeof render === 'function') {
			return render({ ...uri })
		}

		return null
	}

	render = () => (
		<React.Fragment key={this.state.currentURL ?? 'null'}>
			{this.#renderRoute()}
		</React.Fragment>
	)
}