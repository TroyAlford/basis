/**
 * Keyboard key constants for consistent key handling across components.
 *
 * These values correspond to the `event.key` property from keyboard events.
 * @example
 * import { Keyboard } from '@basis/react/types/Keyboard'
 *
 * if (event.key === Keyboard.Enter) {
 *   // Handle Enter key
 * }
 */
export enum Keyboard {
  /** Arrow Down key */
  ArrowDown = 'ArrowDown',
  /** Arrow Left key */
  ArrowLeft = 'ArrowLeft',
  /** Arrow Right key */
  ArrowRight = 'ArrowRight',
  /** Arrow Up key */
  ArrowUp = 'ArrowUp',
  /** Backspace key */
  Backspace = 'Backspace',
  /** Delete key */
  Delete = 'Delete',
  /** End key */
  End = 'End',
  /** Enter key */
  Enter = 'Enter',
  /** Escape key */
  Escape = 'Escape',
  /** Home key */
  Home = 'Home',
  /** Page Down key */
  PageDown = 'PageDown',
  /** Page Up key */
  PageUp = 'PageUp',
  /** Space key */
  Space = ' ',
  /** Tab key */
  Tab = 'Tab',
}
