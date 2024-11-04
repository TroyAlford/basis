import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
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
  })

  describe('window', () => {
    test('window.application & window.ApplicationContext', () => {
      const { instance } = render<TestApplication>(<TestApplication />)

      expect(window.ApplicationBase).toBe(instance)
      expect(window.ApplicationContext).toBe(instance.Context)
    })
  })
})
