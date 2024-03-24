import * as React from 'react'
import * as ReactDOM from 'react-dom'

type PropsOf<C> = C extends React.ReactElement<infer P> ? P : unknown
type Class<T> = new (...args: unknown[]) => T
type Fn<T> = (...args: unknown[]) => T
type Ctor<T> = Class<T> | Fn<T>
type Fiber = {
	child?: Fiber,
	children?: Fiber[],
	memoizedProps?: object,
	return?: Fiber,
	sibling?: Fiber,
	stateNode?: object,
	type?: Ctor<unknown> | string,
}

export function render<
	C extends React.Component | React.FunctionComponent = React.Component,
	N extends Element | Element[] = HTMLElement,
>(jsx: JSX.Element, target?: HTMLElement) {
	const root = target ?? document.createElement('div')

	/* eslint-disable react/no-deprecated */
	const instance = ReactDOM.render<PropsOf<C>>(jsx, root) as unknown as C
	const unmount = () => ReactDOM.unmountComponentAtNode(root)
	/* eslint-enable react/no-deprecated */

	function* search<I>(ctor: Ctor<I> | string) {
		// @ts-expect-error - accessing private/hidden methods
		const rootNode = instance?._reactInternals ?? instance?._reactInternalFiber
		const queue: Array<Fiber> = [rootNode]

		while (queue.length) {
			const node = queue.shift()

			if (node?.type === ctor && node?.return !== null) {
				yield (node?.stateNode ?? { props: node?.memoizedProps}) as I
			}

			if (node?.sibling) queue.push(node.sibling)
			if (node?.child) queue.push(node.child)
		}

		return null
	}

	return {
		find: <I>(ctor: Ctor<I> | string) => search<I>(ctor).next()?.value ?? null,
		findAll: <I>(ctor: Ctor<I>): Array<I> => Array.from(search<I>(ctor)),
		instance,
		node: (
			root.children.length > 1
				? Array.from(root.children)
				: root.children.item(0)
		) as N,
		root,
		unmount,
		update: (updatedJSX: JSX.Element = React.cloneElement(jsx, jsx.props)) => (
			render<C, N>(updatedJSX, root)
		),
	}
}