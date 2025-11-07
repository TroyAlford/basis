import { describe, expect, test } from 'bun:test'
import { clamp } from './clamp'

describe('clamp', () => {
  test('returns the value when within range', () => {
    expect(clamp(5, { max: 10, min: 0 })).toBe(5)
    expect(clamp(0, { max: 10, min: 0 })).toBe(0)
    expect(clamp(10, { max: 10, min: 0 })).toBe(10)
  })

  test('clamps to minimum when value is below min', () => {
    expect(clamp(-5, { max: 10, min: 0 })).toBe(0)
    expect(clamp(-100, { max: 10, min: 0 })).toBe(0)
    expect(clamp(-0.1, { max: 1, min: 0 })).toBe(0)
  })

  test('clamps to maximum when value is above max', () => {
    expect(clamp(15, { max: 10, min: 0 })).toBe(10)
    expect(clamp(100, { max: 10, min: 0 })).toBe(10)
    expect(clamp(1.1, { max: 1, min: 0 })).toBe(1)
  })

  test('works with negative ranges', () => {
    expect(clamp(-5, { max: -1, min: -10 })).toBe(-5)
    expect(clamp(-15, { max: -1, min: -10 })).toBe(-10)
    expect(clamp(0, { max: -1, min: -10 })).toBe(-1)
  })

  test('works with decimal values', () => {
    expect(clamp(0.5, { max: 1, min: 0 })).toBe(0.5)
    expect(clamp(0.25, { max: 0.5, min: 0 })).toBe(0.25)
    expect(clamp(0.75, { max: 0.5, min: 0 })).toBe(0.5)
  })

  test('defaults to -Infinity for min when not provided', () => {
    expect(clamp(-1000, { max: 10 })).toBe(-1000)
    expect(clamp(-Infinity, { max: 10 })).toBe(-Infinity)
    expect(clamp(15, { max: 10 })).toBe(10)
  })

  test('defaults to Infinity for max when not provided', () => {
    expect(clamp(1000, { min: 0 })).toBe(1000)
    expect(clamp(Infinity, { min: 0 })).toBe(Infinity)
    expect(clamp(-5, { min: 0 })).toBe(0)
  })

  test('works with no options (returns value unchanged)', () => {
    expect(clamp(5, {})).toBe(5)
    expect(clamp(-5, {})).toBe(-5)
    expect(clamp(1000, {})).toBe(1000)
    expect(clamp(Infinity, {})).toBe(Infinity)
    expect(clamp(-Infinity, {})).toBe(-Infinity)
  })

  test('works with only min', () => {
    expect(clamp(5, { min: 0 })).toBe(5)
    expect(clamp(-5, { min: 0 })).toBe(0)
    expect(clamp(1000, { min: 0 })).toBe(1000)
  })

  test('works with only max', () => {
    expect(clamp(5, { max: 10 })).toBe(5)
    expect(clamp(15, { max: 10 })).toBe(10)
    expect(clamp(-1000, { max: 10 })).toBe(-1000)
  })

  test('handles edge case where min equals max', () => {
    expect(clamp(5, { max: 10, min: 10 })).toBe(10)
    expect(clamp(15, { max: 10, min: 10 })).toBe(10)
    expect(clamp(10, { max: 10, min: 10 })).toBe(10)
  })

  test('handles zero values correctly', () => {
    expect(clamp(0, { max: 10, min: -10 })).toBe(0)
    expect(clamp(0, { max: 0, min: 0 })).toBe(0)
    expect(clamp(5, { max: 0, min: -10 })).toBe(0)
    expect(clamp(-5, { max: 10, min: 0 })).toBe(0)
  })
})
