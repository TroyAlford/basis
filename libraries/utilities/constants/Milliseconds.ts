/** Milliseconds constants */
export const Milliseconds = {
  /**
   * Milliseconds per day
   * @returns Milliseconds per day
   */
  get PerDay() { return this.PerHour * 24 },
  /**
   * Milliseconds per hour
   * @returns Milliseconds per hour
   */
  get PerHour() { return this.PerMinute * 60 },
  /**
   * Milliseconds per minute
   * @returns Milliseconds per minute
   */
  get PerMinute() { return this.PerSecond * 60 },
  /**
   * Milliseconds per nanosecond
   * @returns Milliseconds per nanosecond
   */
  get PerNanosecond() { return 1 / 1_000_000 },
  /**
   * Milliseconds per second
   * @returns Milliseconds per second
   */
  PerSecond: 1_000,
  /**
   * Milliseconds per week
   * @returns Milliseconds per week
   */
  get PerWeek() { return this.PerDay * 7 },
  /**
   * Milliseconds per year (accounting for leap years)
   * @returns Milliseconds per year
   */
  get PerYear() { return this.PerDay * 365.25 },
} as const
