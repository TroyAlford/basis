import * as React from 'react'
import { ApplicationBase, Link, Router } from '@basis/react'

export class Application extends ApplicationBase {
	content() {
		return <>
			<h1>Application</h1>
			<Router>
				<Router.Route template='/:type/:id'>
					{params => <>
						<p>{JSON.stringify(params)}</p>
						<Link to='/foo/123'>Foo</Link>
						<Link to='/bar/234'>Bar</Link>
					</>}
				</Router.Route>
			</Router>
		</>
	}
}
