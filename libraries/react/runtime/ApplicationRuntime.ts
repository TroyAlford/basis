import type { BasisRuntime } from '../../utilities'
import type { ServerSubscriptions } from './ServerSubscriptions'

/**
 * The standard Basis application runtime context.
 *
 * ApplicationBase owns this alongside the application's typed domain context
 * (`C`): immutable startup facts, the server-event subscription facility, and
 * framework navigation. It is deliberately free of domain semantics — the
 * concrete Application decides how events update its own context.
 */
export interface ApplicationRuntime {
  /** Shared server-published event subscriptions. */
  events: ServerSubscriptions,
  /** Navigate to a client-side route. */
  navigate: (url: string) => Promise<boolean>,
  /** Immutable startup facts supplied by the platform. */
  runtime: BasisRuntime,
}
