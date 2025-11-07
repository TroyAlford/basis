interface ClampOptions {
  max?: number,
  min?: number,
}

/**
 * Clamps a number between a minimum and maximum value.
 * @param value The number to clamp
 * @param options Options containing min and max values
 * @returns The clamped value
 * @example
 * clamp(5, { min: 0, max: 10 })  // 5
 * clamp(-5, { min: 0, max: 10 }) // 0
 * clamp(15, { min: 0, max: 10 }) // 10
 * clamp(5, { min: 0 })           // 5
 * clamp(5, { max: 10 })          // 5
 */
export function clamp(value: number, options: ClampOptions = {}): number {
  const { max = Infinity, min = -Infinity } = options
  return Math.min(Math.max(value, min), max)
}
