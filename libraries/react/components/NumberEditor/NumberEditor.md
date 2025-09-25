# NumberEditor: Cursor + Formatting Strategy

## Plain-English Algorithm (Step-by-Step)

1. Before applying any formatting or mutation, record how many **digits** (0–9) lie **before** and **after** the cursor (or selection) in the *raw / sanitized* string.

2. Let the user’s edit (typing, pasting, deleting) mutate the raw/sanitized string.

3. Format the resulting string (insert commas, enforce decimal rules, etc.), producing a nicely formatted version.

4. Count how many digits are in the formatted string in total (`totalDigits_new`).

5. Compute the target number of digits *before* the cursor in the new string:
  ```
  targetDigitsBefore = totalDigits_new − digitsAfter_old
  ```

This ensures the same count of digits remain “after” the cursor as before.

6. Walk through the formatted string, skipping non-digit characters (commas, `.` or `-`), until you have passed `targetDigitsBefore` digits. Place the cursor right after that Nth digit.

7. Perform the actual cursor/selection placement **after** the DOM has rendered (e.g. in a layout effect or componentDidUpdate), so you don’t fight React/browser default caret resets.

8. In boundary or odd cases (cursor at start, end, formatting changed digit counts), clamp or fallback to start/end or the nearest valid spot.

> ⚠️ Note: The decimal point `.` and minus sign `-` are treated purely as formatting tokens in this logic — they do *not* count in the digit index arithmetic. This makes the cursor math more stable in weird paste/sanitize scenarios.

---

## Detailed Explanation & Helpers

### Why count only digits?

- `.` and `-` may move, be dropped, or be reinserted by the sanitize/format logic, causing brittle cursor jumps if you include them in the index math.
- The user’s intuitive cursor intention is about *which digit* they were next to, not about punctuation.
- Your use cases (e.g. pasting “8.88” in the middle) align better if you anchor logic on digit positions.

### Core helper functions you’ll need

- `countDigits(str: string): number` — counts only `'0'..'9'` in the string.
- `sanitize(input: string | number): string` — cleans the raw string (drops invalid chars, ensures at most one `.`, handles `-`, etc.).
- `formatNumber(value: string | number): string` — produces a human-friendly formatted string (e.g. adds commas).
- `getCursorDigitContext(inputEl: HTMLInputElement): { digitsBefore: number; digitsAfter: number }` — based on `selectionStart` / `selectionEnd` on the raw string, derive how many digits are before and after the cursor/selection.
- `setCursorByDigitIndex(inputEl: HTMLInputElement, formatted: string, targetDigitsBefore: number)` — walk the `formatted` string, counting digits, and place the cursor just after the Nth digit.

### React / Rendering Integration

- In `onChange` (or your input handler), capture `digitsAfter_old` *before* formatting.
- Update state / props so your `value` becomes the formatted string.
- In a post-render hook (e.g. `componentDidUpdate` or `useLayoutEffect`), compute:
- `totalDigits_new = countDigits(formatted)`
- `targetDigitsBefore = totalDigits_new − digitsAfter_old`
- Then call `setCursorByDigitIndex(...)` on the input to reposition the caret/selection.
- This ensures the cursor move happens after React/DOM update, avoiding conflicts.

### Edge Cases & Fallbacks

- **Cursor at start / no digits before** → if `targetDigitsBefore ≤ 0`, place cursor at position 0.
- **Cursor at end / no digits after** → if `targetDigitsBefore` ≥ `totalDigits_new`, place cursor at end of formatted string.
- **Range selection (not just caret):** map both selection start and end to digit indices, transform both, and reapply the selection.
- **Formatting changed digit count drastically:** clamp `targetDigitsBefore` into `[0, totalDigits_new]`.
- **User editing around decimal or minus:** you may add heuristics so if cursor was adjacent to `.` or `-`, preserve that relative side, instead of strictly pushing it among digits.
- **No-op input:** if sanitized new string == sanitized previous string, skip formatting / cursor movement to avoid jitter.

---

## Example Walkthroughs

### Example A:  
`123|,456` → paste `8.88` → formatted `1,238.88`

- Original raw: digitsBefore = 3, digitsAfter = 3  
- After formatting: totalDigits_new = 6 (digits = `123888`)  
- targetDigitsBefore = 6 − 3 = 3  
- In `"1,238.88"`, skip non-digits and position after the first 3 digits (`1`, `2`, `3`) → result: `1,238.88|456`

### Example B:  
`12|3,45|6` → paste `8.88` → formatted `128.88`

- Original raw: digitsBefore = 2, digitsAfter = 4  
- totalDigits_new = 5 (digits = `12888`)  
- targetDigitsBefore = 5 − 4 = 1  
- In `"128.88"`, the first digit is `1`, so cursor goes just after → `1|28.88` + suffix → `128.88|6`

# NumberEditor Cursor & Formatting Algorithm

This document describes the **cursor and formatting algorithm** used by the `NumberEditor` component. It covers both plain-English and technical details, and clearly distinguishes between input/paste (`onChange`) and key-based editing (`onKeyDown` for Backspace/Delete).

---

## Overview

The `NumberEditor` ensures that, after any user edit (typing, pasting, deleting), the cursor remains anchored to the **same logical digit position**—even as formatting (like commas) is applied or removed. This is crucial for a smooth editing experience in formatted numeric fields.

---

## Algorithm: Step by Step

### 1. **Record Cursor Digit Context (Before Mutation)**

- Before any formatting or mutation, record **how many digits** (`0–9`) are:
  - **Before** the cursor (or selection start)
  - **After** the cursor (or selection end)
  - (If a selection is present, track both start and end.)

### 2. **Apply User Edit**

- Let the user's action (typing, pasting, or key press) mutate the raw string.
- For typing/paste (`onChange`): mutate the value directly.
- For Backspace/Delete (`onKeyDown`): let the browser perform the mutation, then handle formatting and cursor logic.

### 3. **Sanitize and Format**

- **Sanitize**: Remove all invalid characters, collapse multiple `.` or `-`, etc.
- **Format**: Insert commas, enforce decimal/negative rules.

### 4. **Count Digits in Formatted Result**

- After formatting, count the **total number of digits** in the new string.

### 5. **Compute Target Digit Index**

- To keep the logical position stable, compute:
  ```
  targetDigitsBefore = totalDigits_new - digitsAfter_old
  ```
- This ensures the same number of digits remain **after** the cursor as before.

### 6. **Map Digit Index to String Position**

- Walk through the formatted string, skipping non-digit characters (commas, `.`, `-`), and place the cursor **after** the Nth digit (`targetDigitsBefore`).

### 7. **Set Cursor/Selection**

- After React/DOM updates (e.g., in a layout effect), set the cursor/selection range accordingly.

### 8. **Handle Edge Cases**

- Clamp the cursor to start/end if needed.
- For selection ranges, apply the mapping to both start and end.
- If formatting changed the digit count drastically, clamp `targetDigitsBefore` to `[0, totalDigits_new]`.
- If the sanitized value didn't change, skip formatting/cursor movement.

---

## Disambiguating `onKeyDown` vs `onChange`

### - **Backspace/Delete (`onKeyDown`):**
  - The browser mutates the input value and updates the cursor.
  - After the DOM change, re-sanitize and re-format the value.
  - Recompute the cursor position using the digit-counting algorithm above.
  - **Do not** prevent default for Backspace/Delete; let the browser handle the mutation, then correct formatting/cursor as needed.

### - **Typing/Paste (`onChange`):**
  - The new value is available in the event.
  - Before formatting, record the number of digits after the new cursor position.
  - Format and update the value.
  - Set the cursor so the same number of digits are after the cursor as before.

---

## Helper Functions

- `sanitize(value: string | number): string`
  - Removes all invalid characters, ensures at most one `.` and one `-`, etc.
- `formatNumber(value: string | number): string`
  - Returns a human-formatted string (adds commas, etc.).
- `countDigits(str: string): number`
  - Counts only the characters `'0'..'9'` in the string.
- `getCursorDigitContext(input: HTMLInputElement): { digitsBefore, digitsAfter }`
  - Based on `selectionStart`/`selectionEnd`, counts digits before and after the cursor.
- `setCursorByDigitIndex(input: HTMLInputElement, formatted: string, targetDigitsBefore: number)`
  - Walks the formatted string, counting digits, and places the cursor after the Nth digit.

---

## Edge Cases & Fallbacks

- **Cursor at start:** If `targetDigitsBefore <= 0`, place the cursor at position 0.
- **Cursor at end:** If `targetDigitsBefore >= totalDigits_new`, place at the end.
- **Selection ranges:** Map both ends of the selection to digit indices, and restore both.
- **Formatting changes digit count:** Clamp `targetDigitsBefore` to `[0, totalDigits_new]`.
- **User edits near `.` or `-`:** Optionally, preserve adjacency to these characters if that's more intuitive.
- **No change:** If sanitized new string equals sanitized previous string, skip format/cursor update.

---

## Example Walkthroughs

### Example 1: Paste in the Middle

**Initial:**  
`123|,456` (cursor after `3`)  
**User pastes:** `8.88`

**Steps:**
- Digits before: 3 (`123`)
- Digits after: 3 (`456`)
- After paste and format: `1,238.88`
- Digits in new string: 6 (`123888`)
- `targetDigitsBefore = 6 - 3 = 3`
- Place cursor after the 3rd digit: `1,238.88|`

### Example 2: Selection Replace

**Initial:**  
`12|3,45|6` (selection from after `2` to after `5`)
**User pastes:** `8.88`

**Steps:**
- Digits before: 2 (`12`)
- Digits after: 1 (`6`)
- After paste and format: `128.88`
- Digits in new string: 5 (`12888`)
- `targetDigitsBefore = 5 - 1 = 4`
- Place cursor after 4 digits: `1288|.8`

---

## Summary Table: Event Handling

| Event Type         | Input Handler | What Happens?                                       |
|--------------------|--------------|-----------------------------------------------------|
| Typing/Paste       | `onChange`   | Sanitize, format, reposition cursor by digit index. |
| Backspace/Delete   | `onKeyDown`  | Let browser mutate, then sanitize/format/cursor.    |
| Arrow Up/Down      | `onKeyDown`  | Step value, format, set cursor at end.              |

---

## Why "Digits-Only"?

- Formatting characters (`.`, `,`, `-`) may move, appear, or disappear. Counting only digits makes the logic robust and user-friendly.
- The user's intent is almost always about **which digit** they're next to, not punctuation.

---

## Implementation Note

- The actual implementation may use helpers like `countNumericChars`, `getCursorPosition`, and `setCursorPosition` (see `NumberEditor.tsx`).
- Always perform cursor movement **after** formatting and DOM update to avoid browser/React caret jumps.
