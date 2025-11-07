/**
 * A partial polyfill for the Location API for server-side rendering in Bun.
 * Provides the minimal interface needed by the Router component.
 */
export class Location {
  readonly href = ''
  readonly origin = ''
  readonly pathname = ''
  readonly search = ''
  readonly hash = ''
  readonly protocol = ''
  readonly host = ''
  readonly hostname = ''
  readonly port = ''

  /**
   * Returns the string representation of the location.
   * @returns The href property
   */
  toString(): string {
    return this.href
  }
}
