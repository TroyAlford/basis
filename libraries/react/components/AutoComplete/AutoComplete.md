# AutoComplete Component Analysis & Implementation Plan

## Current Usage Analysis

### SearchBox Component Usage
The current `SearchBox` component uses Ant Design's `AutoComplete` with these key features:

**Props Used:**
- `className` - Custom CSS classes
- `notFoundContent` - Custom "No Results Found" message
- `onSearch` - Debounced search callback (100ms delay)
- `onSelect` - Selection handler that navigates to article
- `options` - Array of search result objects
- `popupClassName` - Custom CSS for dropdown
- `value` - Controlled input value

**Options Structure:**
```typescript
interface AutoCompleteOption {
  key: string,        // result.slug
  label: ReactNode,   // Custom JSX with title/preview
  title: string,      // result.headline (for accessibility)
  value: string,      // result.slug
}
```

**SearchResult Data:**
```typescript
interface SearchResult {
  headline: string,   // Article title
  id: string,        // Unique identifier
  preview: string,   // Text preview
  rank: number,      // Search ranking
  slug: string,      // URL slug
}
```

**Key Behaviors:**
1. Debounced search (100ms) with abort controller for cancellation
2. Minimum length requirement (configurable, default 0)
3. Custom "No Results Found" message when search term exists but no results
4. Custom option rendering with HTML content (dangerouslySetInnerHTML)
5. Navigation on selection (window.location.assign)
6. Input with prefix icon (Search icon)

## Component Architecture Analysis

### TextEditor (Input Base)
- Extends `Editor<string>` base class
- Supports both `input[type="text"]` and `textarea` elements
- Has mixins: `Accessible`, `PrefixSuffix`, `Placeholder`, `Focusable`
- Key features: auto-focus, select-on-focus, multiline support, keyboard handling
- Controlled/uncontrolled value management via Editor base

### PopupMenu (Dropdown Base)
- Extends `Component` with `Popup` mixin
- Uses `Menu` component as the actual content
- Key features: positioning, arrow support, offset, anchor points
- Auto-shows/hides based on visibility prop

### DropdownMenu (Composite Pattern)
- Combines `Button` (trigger) + `PopupMenu` (dropdown)
- Manages open/close state internally
- Handles keyboard navigation (Escape to close)
- Clones children to add close-on-activate behavior
- Focus management (focuses first menu item on open)

### Menu (Content Structure)
- Provides keyboard navigation (arrow keys)
- Supports vertical/horizontal orientation
- MenuItem components with activation handling
- Divider support for visual separation

## Implementation Plan

### Generic AutoComplete Component Structure
```typescript
class AutoComplete<T = unknown> extends Component<Props<T>, HTMLDivElement, State<T>> {
  // Combines TextEditor + PopupMenu pattern
  // Manages search state and async option loading
  // Handles keyboard navigation between input and options
  // Generic over the option data type T
}
```

### Key Features to Implement

1. **Input Integration**
   - Use `TextEditor` as the input component
   - Support all TextEditor props (prefix, suffix, placeholder, etc.)
   - Handle focus/blur for dropdown visibility

2. **Dropdown Integration**
   - Use `PopupMenu` + `Menu` for the options list
   - Position relative to input element
   - Support custom option rendering

3. **Async Search & Loading**
   - Async search function: `(query: string) => Promise<T[]>`
   - Debounced search callback
   - Minimum length requirement
   - Abort controller for request cancellation
   - Loading states

4. **Selection Handling**
   - Keyboard navigation (arrow keys, Enter, Escape)
   - Mouse selection
   - Custom selection callback with typed option data
   - Value management (controlled/uncontrolled)

5. **Accessibility**
   - ARIA attributes (aria-expanded, aria-haspopup, etc.)
   - Keyboard navigation
   - Screen reader support
   - Focus management

### Generic Props Interface
```typescript
interface Props<T = unknown> extends IAccessible, IPrefixSuffix, IPlaceholder, IFocusable {
  // Async search behavior
  onSearch: (query: string) => Promise<T[]>,
  minLength?: number,
  
  // Selection
  onSelect?: (value: string, option: T) => void,
  value?: string,
  defaultValue?: string,
  
  // Option rendering
  getOptionValue: (option: T) => string,
  getOptionLabel: (option: T) => ReactNode,
  getOptionKey?: (option: T) => string,
  getOptionDisabled?: (option: T) => boolean,
  
  // Dropdown behavior
  open?: boolean,
  onOpen?: () => void,
  onClose?: () => void,
  closeOnSelect?: boolean,
  
  // Customization
  className?: string,
  popupClassName?: string,
  notFoundContent?: ReactNode,
  loadingContent?: ReactNode,
  optionRender?: (option: T) => ReactNode,
}
```

### State Management
```typescript
interface State<T = unknown> {
  open: boolean,
  searchValue: string,
  selectedIndex: number,
  options: T[],
  loading: boolean,
  error: Error | null,
}
```

### Usage Examples

**Basic Usage:**
```typescript
<AutoComplete<SearchResult>
  onSearch={async (query) => {
    const response = await fetch(`/api/search?q=${query}`)
    return response.json()
  }}
  getOptionValue={(result) => result.slug}
  getOptionLabel={(result) => (
    <div>
      <div>{result.headline}</div>
      <div>{result.preview}</div>
    </div>
  )}
  onSelect={(value, option) => {
    window.location.assign(`/article/${value}`)
  }}
  placeholder="Search articles..."
/>
```

**Simple String Array:**
```typescript
<AutoComplete<string>
  onSearch={async (query) => {
    return ['apple', 'banana', 'cherry'].filter(fruit => 
      fruit.includes(query.toLowerCase())
    )
  }}
  getOptionValue={(fruit) => fruit}
  getOptionLabel={(fruit) => fruit}
  onSelect={(value) => console.log('Selected:', value)}
/>
```

**Complex Object:**
```typescript
interface User {
  id: string
  name: string
  email: string
  avatar?: string
}

<AutoComplete<User>
  onSearch={async (query) => {
    const response = await fetch(`/api/users/search?q=${query}`)
    return response.json()
  }}
  getOptionValue={(user) => user.id}
  getOptionLabel={(user) => (
    <div className="user-option">
      <img src={user.avatar} alt="" />
      <span>{user.name}</span>
      <span>{user.email}</span>
    </div>
  )}
  getOptionKey={(user) => user.id}
  onSelect={(userId, user) => {
    console.log('Selected user:', user)
  }}
/>
```

### Implementation Steps

1. **Create Generic Base Structure**
   - AutoComplete<T> component extending Component
   - Generic Props<T> interface with type-safe option handling
   - State management for async search, loading, and error states

2. **Integrate TextEditor**
   - Use TextEditor as the input component
   - Handle focus/blur for dropdown visibility
   - Pass through all TextEditor props and mixins

3. **Integrate PopupMenu**
   - Use PopupMenu for dropdown positioning
   - Handle open/close state management
   - Position relative to input element

4. **Add Async Search Functionality**
   - Generic onSearch: `(query: string) => Promise<T[]>`
   - Debounced search with abort controller
   - Loading and error state management
   - Type-safe option handling

5. **Add Selection Handling**
   - Keyboard navigation (arrows, Enter, Escape)
   - Mouse selection with typed option data
   - Custom option rendering via getOptionLabel/getOptionRender

6. **Add Accessibility**
   - ARIA attributes (aria-expanded, aria-haspopup, etc.)
   - Focus management between input and options
   - Screen reader support with proper labeling

7. **Add Styling**
   - CSS for dropdown appearance
   - Option highlighting and selection states
   - Loading and error state styling

8. **Add Tests**
   - Unit tests for all functionality with different generic types
   - Integration tests with TextEditor/PopupMenu
   - Accessibility tests
   - Type safety tests

### Migration Strategy

1. **Create generic AutoComplete<T> in basis repo**
2. **Update SearchBox to use new AutoComplete<SearchResult>**
3. **Remove antd AutoComplete dependency**
4. **Test and refine with real search data**

### Benefits of This Generic Approach

1. **Type Safety** - Full TypeScript support with generic option types
2. **Flexibility** - Works with any data shape (strings, objects, complex types)
3. **Reusability** - Can be used across different projects with different data types
4. **Consistency** - Uses existing basis components and patterns
5. **Maintainability** - No external dependencies, full control
6. **Accessibility** - Built on accessible basis components
7. **Performance** - Optimized for async operations with abort controllers
8. **Developer Experience** - Clear API with required vs optional props

### Potential Challenges

1. **Type Complexity** - Managing generic types and ensuring type safety
2. **Async State Management** - Handling loading, error, and success states
3. **Keyboard Navigation** - Ensuring proper focus management with dynamic options
4. **Positioning** - Getting dropdown positioning right with async content
5. **Performance** - Debouncing async requests efficiently
6. **Accessibility** - Ensuring full screen reader support with dynamic content

### Key Design Decisions

1. **Generic over Option Shape** - Component doesn't care about data structure
2. **Required onSearch** - Forces explicit async search implementation
3. **Required Option Getters** - Clear contract for how to extract values/labels
4. **Optional Customization** - Sensible defaults with escape hatches
5. **Abort Controller Support** - Proper cleanup of in-flight requests
6. **Loading States** - Built-in support for async operation feedback

This generic approach provides a solid foundation for implementing a reusable AutoComplete component that can handle any data type while maintaining type safety and leveraging the existing basis component architecture.
