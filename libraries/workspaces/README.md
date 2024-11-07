# @basis/workspaces

CLI tools and utilities for managing workspaces in a monorepo.

## Installation

```bash
bun add -d @basis/workspaces
```

## CLI Usage

The package provides two CLI commands that can be used interchangeably:
- `workspace` (full name)
- `ws` (shorthand)

### Commands

#### List Workspaces
Lists all workspaces in the monorepo:
```bash
# List all workspaces
bun ws list

# List only @basis packages
bun ws list --only '^@basis/'

# List all except test packages
bun ws list --not 'test'

# Combine filters
bun ws list --only '^@basis/' --not 'internal'
```

#### Find Workspace Path
Get the filesystem path of a workspace:
```bash
# Find a specific workspace
bun ws find @basis/utilities

# Usage in scripts
cd "$(bun ws find @basis/utilities)"
```

#### List Changed Files
Show files that have changed since the last tag:
```bash
# Show all changed files
bun ws changed-files

# Only show TypeScript files
bun ws changed-files --only '\.tsx?$'

# Show all files except tests
bun ws changed-files --not '\.test\.'
```

#### List Changed Workspaces
Show workspaces that have changes (including dependency changes):
```bash
# Show all changed workspaces
bun ws changed

# Only show changed @basis packages
bun ws changed --only '^@basis/'
```

#### Build Package
Build a specific package:
```bash
# Build with default options
bun ws build @basis/utilities

# Specify version and output directory
bun ws build @basis/utilities -v 1.0.0 -o dist

# Build with license handling
bun ws build @basis/utilities --license auto    # Use local LICENSE or inherit from root
bun ws build @basis/utilities --license inherit # Always use root LICENSE
bun ws build @basis/utilities --license none    # Skip license handling

# Build all packages
bun ws build-all                    # Build all workspaces
bun ws build-all --only '^@basis/'  # Build only @basis packages
bun ws build-all -v 1.0.0          # Build all with specific version
```

### Filtering

Both `--only` and `--not` options:
- Accept multiple values
- Use regular expressions for matching
- Can be combined

Examples:
```bash
# Multiple inclusion patterns
bun ws list --only '^@basis/' --only '^@app/'

# Combine inclusion and exclusion
bun ws list --only '^@basis/' --not 'internal' --not 'test'
```

## Programmatic Usage

The package also exports utilities for programmatic use:

```typescript
import {
  findWorkspace,
  getAllWorkspaces,
  getChangedWorkspaces,
  getWorkspaceInfo,
} from '@basis/workspaces'

// Get all workspace names
const workspaces = await getAllWorkspaces()

// Get changed workspace names
const changed = await getChangedWorkspaces()

// Find specific workspace info
const workspace = await findWorkspace('@basis/utilities')
if (workspace) {
  console.log(workspace.packagePath)
  console.log(workspace.packageJson)
}

// Get detailed workspace information
const info = await getWorkspaceInfo()
console.log(info.packages) // Map of package.json contents
console.log(info.paths)    // Map of filesystem paths
```

## Types

The package exports these TypeScript types:
- `PackageJSON`: Extended package.json type
- `Workspace`: Single workspace information
- `WorkspaceInfo`: Project-wide workspace information
