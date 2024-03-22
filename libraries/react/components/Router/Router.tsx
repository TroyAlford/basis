import { matchTemplateURI, parseTemplateURI } from '@basis/utilities'
import * as React from 'react'

type Route<Props extends object = object> = {
	component: React.ComponentType<Props>,
}

type Props = {
	routes: Map<string, Route>,
}

export class Router extends React.Component<Props> {
	get template(): string {
		const path = '/foo/bar' // global?.location?.pathname
		return matchTemplateURI(path, this.props.routes?.keys())
	}

	get component(): React.ComponentType {
		return this.props.routes.get(this.template)?.component
	}

	get routeParams(): object {
		return parseTemplateURI(window.location.pathname, this.template) ?? {}
	}

	render() {
		const { component } = this
		if (!component) return null

		return React.createElement(component, this.routeParams)
	}
}