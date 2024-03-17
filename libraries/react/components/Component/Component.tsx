import * as React from 'react'
import { dataAttributes } from '@basis/utilities'

export interface ComponentProps {
	/** The children of the component. */
	children?: React.ReactNode,
	/** An optional collection of data-* attributes to output on the component's root element. */
	data?: Record<string, boolean | number | string>,
}

/**
 * The abstract base @basis/react components extend from.
 * 
 * @extends {React.Component<Props, State, SnapShot>}
 * @template Props
 * @template State
 * @template SnapShot
 */
export abstract class Component<
	Props extends ComponentProps = ComponentProps,
	State = object,
	SnapShot = object
> extends React.Component<Props, State, SnapShot>  {
	/** Getter for root element. */
	#element: HTMLElement = null
	get element(): HTMLElement | null { return this.#element }

	/** Getter for initialState. */
	get initialState(): State { return {} as State }

	/**
	 * The basic HTMLElement tag name or React component constructor of the component's root node.
	 * @default 'div', which renders an `HTMLDivElement`
	 */
	get tag(): string | React.ComponentType<Props> { return 'div' }

	render = () => {
		const Tag = this.tag
		const { data, ...props } = this.props

		return (
			<Tag
				{...dataAttributes(data)}
				{...props}
				ref={el => { this.#element = el }}
				data={this.props.data}
			>
				{this.props.children}
			</Tag>
		)
	}
}