import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Component } from '../Component/Component'
import { ApplicationBase } from './ApplicationBase'

export class TestApplication extends ApplicationBase {
	get defaultContext() {
		return {
			...super.defaultContext,
			foo: 'bar',
		}
	}
}

describe('Application', () => {
	describe('renders', () => {
		test('wraps children in a context provider', () => {
			const { find, instance } = render<TestApplication>(
				<TestApplication>
					<span>Foo!</span>
				</TestApplication>
			)
			const provider = find(instance.Context.Provider)
			expect(provider.props).toMatchObject({
				children: <span>Foo!</span>,
				value: instance.state.context,
			})
		})
	})

	describe('Context', () => {
		test('default context', () => {
			const { instance } = render<TestApplication>(<TestApplication />)
			expect(instance.state.context).toEqual(instance.defaultContext)
		})

		test('setContext', () => {
			const { instance } = render<TestApplication>(<TestApplication />)

			instance.setContext({ foo: 'baz' })
			expect(instance.state.context).toEqual({ foo: 'baz' })

			instance.setContext({ foo: { bar: 'baz' } })
			expect(instance.state.context).toEqual({ foo: { bar: 'baz' } })
		})

		test('correctly binds child Component instances', () => {
			class TestComponent extends Component {}

			const { find, instance } = render<TestApplication>(
				<TestApplication>
					<TestComponent />
				</TestApplication>
			)
			const component = find(TestComponent)
			expect(component.context).toBe(instance.state.context)

			instance.setContext({ foo: 'baz' })
			expect(component.context).toEqual({ foo: 'baz' })
		})
	})

	describe('window', () => {
		test('window.application & window.ApplicationContext', () => {
			const { instance } = render<TestApplication>(<TestApplication />)

			expect(window.ApplicationBase).toBe(instance)
			expect(window.ApplicationContext).toBe(instance.Context)
		})
	})
})