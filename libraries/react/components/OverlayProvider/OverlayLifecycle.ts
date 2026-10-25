import { createId } from '../../utilities/createId'

/** The single terminal outcome of a managed overlay. */
export type OverlayOutcome = 'dismissed' | 'resolved'

/** Pre-terminal dismissal guard. Returning `false` vetoes the transition. */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export type OverlayDismissGuard = () => boolean | void | Promise<boolean | void>

/** Pre-terminal resolution guard. Returning `false` vetoes the transition. */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export type OverlayResolveGuard<Value> = (value: Value) => boolean | void | Promise<boolean | void>

/**
 * Lifecycle callbacks shared by dialogs and notifications.
 * @template Value - The resolved value type (notifications have no result).
 */
export interface OverlayLifecycle<Value = never> {
  /** Runs once after an abandonment transition is accepted. */
  onDismissed?: () => void,
  /** Runs before an abandonment transition; `false` keeps the overlay open. */
  onDismissing?: OverlayDismissGuard,
  /** Reports guard, action, or after-hook failures without resurrecting the overlay. */
  onError?: (error: unknown) => void,
  /** Runs once after a resolution transition is accepted. */
  onResolved?: (value: Value) => void,
  /** Runs before a resolution transition; `false` keeps the overlay open. */
  onResolving?: OverlayResolveGuard<Value>,
}

interface Transition {
  kind: 'dismiss' | 'resolve',
  promise: Promise<boolean>,
}

interface OverlayEntryOptions<Value> {
  /** Whether the row belongs to the dialog stack or the notification region. */
  kind: 'dialog' | 'notification',
  /** Provider-owned removal; called exactly once when the entry settles. */
  onRemove: () => void,
  /** Promise settlement for the public handle. */
  onSettled: (result: Value | false) => void,
  /** Lifecycle callbacks and current public options. */
  options: OverlayLifecycle<Value>,
  /** Optional built-in guard that runs before `onDismissing`. */
  prepareDismiss?: () => Promise<boolean>,
}

/**
 * The provider-owned lifecycle shared by dialog and notification rows.
 *
 * It owns the stable id, mutable options, single terminal outcome, transition
 * serialization, callback dispatch, and forced cleanup. Renderers stay
 * type-specific.
 * @template Value - The resolved value type.
 */
export class OverlayEntry<Value = never> {
  readonly id = createId()

  readonly kind: 'dialog' | 'notification'

  options: OverlayLifecycle<Value>

  settled = false

  outcome: OverlayOutcome | null = null

  transition: Transition | null = null

  readonly #onRemove: () => void

  readonly #onSettled: (result: Value | false) => void

  readonly #prepareDismiss?: () => Promise<boolean>

  constructor({
    kind,
    onRemove,
    onSettled,
    options,
    prepareDismiss,
  }: OverlayEntryOptions<Value>) {
    this.kind = kind
    this.#onRemove = onRemove
    this.#onSettled = onSettled
    this.options = options
    this.#prepareDismiss = prepareDismiss
  }

  /**
   * Request abandonment. Repeated requests for the same in-flight transition
   * share its promise; a concurrent resolution request is rejected.
   * @returns Whether the dismissal was accepted.
   */
  dismiss(): Promise<boolean> {
    return this.#request('dismiss')
  }

  /**
   * Request resolution with a value. Repeated requests for the same in-flight
   * transition share its promise; a concurrent dismissal request is rejected.
   * @param value - The value to resolve with.
   * @returns Whether the resolution was accepted.
   */
  resolve(value: Value): Promise<boolean> {
    return this.#request('resolve', value)
  }

  /**
   * Provider teardown: settle immediately as a dismissal without running
   * pre-terminal guards or after-hook vetoes. `onDismissed` still runs once.
   */
  forceDismiss(): void {
    if (this.settled) return
    this.settled = true
    this.outcome = 'dismissed'
    this.#onRemove()
    this.#after('dismissed', false)
    this.#onSettled(false)
  }

  /**
   * Report an error through the configured channel. Falls back to the console
   * so UI-triggered failures are never silent.
   * @param error - The failure to report.
   */
  reportError(error: unknown): void {
    const { onError } = this.options
    if (!onError) {
      // eslint-disable-next-line no-console
      console.error(error)
      return
    }

    try {
      onError(error)
    } catch (nested) {
      // eslint-disable-next-line no-console
      console.error(nested)
    }
  }

  /**
   * Replace the entry's mutable options without changing its identity.
   * @param patch - Options to merge; omitted fields are retained.
   */
  updateOptions(patch: Partial<OverlayLifecycle<Value>>): void {
    if (this.settled) return
    this.options = { ...this.options, ...patch }
  }

  async #request(kind: 'dismiss' | 'resolve', value?: Value): Promise<boolean> {
    if (this.settled) return false

    if (this.transition) {
      return this.transition.kind === kind ? this.transition.promise : false
    }

    const promise = this.#transition(kind, value)
    this.transition = { kind, promise }
    const clear = (): void => {
      if (this.transition?.promise === promise) this.transition = null
    }
    void promise.then(clear, clear)

    return promise
  }

  async #transition(kind: 'dismiss' | 'resolve', value?: Value): Promise<boolean> {
    try {
      if (kind === 'dismiss' && this.#prepareDismiss) {
        if (!(await this.#prepareDismiss())) return false
      }

      if (this.settled) return false

      const guard = kind === 'dismiss'
        ? this.options.onDismissing
        : this.options.onResolving

      if (guard) {
        const allowed = kind === 'dismiss'
          ? await (guard as OverlayDismissGuard)()
          : await (guard as OverlayResolveGuard<Value>)(value as Value)

        if (allowed === false) return false
      }
    } catch (error) {
      this.reportError(error)
      throw error
    }

    if (this.settled) return false

    this.settled = true
    this.outcome = kind === 'dismiss' ? 'dismissed' : 'resolved'
    const result = kind === 'dismiss' ? false : value as Value

    this.#onRemove()
    this.#after(this.outcome, result)
    this.#onSettled(result)

    return true
  }

  #after(outcome: OverlayOutcome, value: Value | false): void {
    try {
      if (outcome === 'dismissed') this.options.onDismissed?.()
      else this.options.onResolved?.(value as Value)
    } catch (error) {
      this.reportError(error)
    }
  }
}
