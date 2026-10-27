# Change Impact

A portable preflight that decides which suites a pull request can affect before the workflow allocates their runners.

It compares the exact merge base with the PR head, enumerates added/modified/deleted/renamed paths, reads a declared policy from the merge base, and evaluates each suite from path rules plus a resolved import graph rooted at that suite's test files and declared entry points. The result is a deterministic JSON decision with an explicit reason and, where the graph proves it, selected test files.

## Why the policy comes from the base

The action reads `.github/ci-impact.json` from the merge base, not from the pull request head. A pull request cannot weaken the gates that validate it. A policy change takes effect only after it is merged; the PR that changes the policy is still analyzed against the old policy. If the policy is absent at the merge base, the action fails closed.

The action itself should be pinned to a released Basis tag. It parses source files; it never executes them.

The runner needs `bash`, `git`, and `bun` on `PATH`; the reference workflow sets up Bun and checks out with full history. The preflight does not install dependencies.

## Inputs and outputs

Inputs:

- `base-ref` (default `origin/main`): ref used to compute the merge base.
- `head-sha` (required): exact PR head commit.
- `config-path` (default `.github/ci-impact.json`): policy path.
- `output-file` (default `impact-decision.json`): decision artifact.
- `working-directory` (default `.`): checkout root.

Outputs:

- `decision`: the complete JSON decision.
- `decision-hash`: SHA-256 of the canonical decision JSON.
- `policy-hash`: SHA-256 of the policy text read from the merge base.
- `merge-base`, `head-sha`, `docs-only`, `any-needed`.
- `quality-needed`, `docs-needed`, `unit-needed`, `visual-needed` for the reference suite names.

The decision also contains `changedFiles`, `docsOnly`, and per-suite `needed`, `reason`, `evidence`, `selectedTests`, and `unknownFiles`.

## Policy schema

```json
{
  "version": 1,
  "maxGraphFiles": 20000,
  "aliases": { "basis/": "./consumer/" },
  "docs": { "globs": ["**/*.md", "**/*.mdx", "docs/**"] },
  "suites": {
    "unit": {
      "testGlobs": ["**/*.test.ts", "**/*.test.tsx"],
      "sourceGlobs": ["**/*.ts", "**/*.tsx"],
      "alwaysRunGlobs": ["package.json", "bun.lock", "bunfig.toml"],
      "ignoreGlobs": ["docs/**", "**/*.md"],
      "extraRoots": [],
      "unreachableSource": "run",
      "mode": "imports"
    }
  }
}
```

- `testGlobs`: this suite's test files. They are import-graph roots. The reference unit suite owns `.test`/`.spec`; the reference visual suite owns `.screenshot`/`.e2e`.
- `testExcludeGlobs`: tests that belong to another suite, such as visual tests excluded from unit.
- `sourceGlobs`: files that can affect the suite.
- `alwaysRunGlobs`: paths that always run the suite, such as manifests, lockfiles, toolchain, preloads, snapshots, styles, and browser configuration.
- `ignoreGlobs`: declared unrelated paths. Reachability from a test root still wins.
- `extraRoots`: non-test entry points, such as a server or docs app entry, whose imports also affect the suite.
- `unreachableSource`: `run` (default, fail-safe) or `skip` (explicit policy).
- `mode`: `imports` (default) or `paths` for suites that only need path rules.

A suite with no decision entry is invalid. A suite entry must have a boolean `needed` and a non-empty `reason`.

The reference `docs` suite uses `ignoreGlobs: ["**"]`. Source, test, always-run and import-reachability checks happen before ignore, so only its declared docs `sourceGlobs` can trigger it; unrelated files are ignored. Add every runtime application entry to the relevant suite's `extraRoots`. The reference visual suite keeps `unreachableSource: run` for `.tsx` and style changes, but a plain `.ts` helper is ignored unless a screenshot or e2e test (or an `extraRoots` entry) reaches it; list your server, docs, and app entries so runtime-loaded code is not missed.

## Conservative rules

The import graph is built from `testGlobs` plus `extraRoots`. A changed file that any root reaches marks the suite needed and records the root test files. A changed test file marks its own suite needed. A test from another suite is ignored unless this suite's graph reaches it.

`selectedTests` is an audit and optional optimization input, not a claim that the rest of the suite is safe to skip. The reference runs the whole affected suite because setup, preloads and global state can create dependencies the file graph cannot see. Use partial selection only when the repository's test runner and setup make it provably safe.

The following are path rules, not guessed dependency edges:

- lockfiles, package manifests, toolchain files, test preloads, browser configuration, and shared testing runtime always run their suites;
- stylesheets, global styles, fonts, runtime assets, and screenshot baselines always run visual when the policy says so;
- docs are documentation-only unless a suite claims them (for example, a visual suite that captures the docs app), and a declared docs suite can run the repository's actual docs check;
- a rename or deletion of a source file runs the affected suite;
- unknown files fail closed across every code suite;
- an unparseable file, a dynamic import, an unreachable source file with `unreachableSource: run`, or a graph over `maxGraphFiles` runs the suite.

`unreachableSource: skip` is only appropriate when the suite's `extraRoots` cover every runtime entry point. The default is `run`.

## Workflow shape

The reference [consumer-ci.yml](../../../docs/examples/consumer-ci.yml) runs the action in a cheap preflight job, then gates each suite job on the preflight output:

```yaml
impact:
  name: Impact
  if: ${{ !github.event.pull_request.draft }}
  runs-on: ubuntu-latest
  outputs:
    decision: ${{ steps.impact.outputs.decision }}
    decision-hash: ${{ steps.impact.outputs.decision-hash }}
    quality-needed: ${{ steps.impact.outputs.quality-needed }}
    docs-needed: ${{ steps.impact.outputs.docs-needed }}
    unit-needed: ${{ steps.impact.outputs.unit-needed }}
    visual-needed: ${{ steps.impact.outputs.visual-needed }}
  steps:
    - uses: actions/checkout@v4
      with:
        # Base repository at the event's base commit, with full history.
        ref: ${{ github.event.pull_request.base.sha }}
        fetch-depth: 0
    - name: Fetch the pull-request head and base branch
      env:
        BASE_REF: ${{ github.event.pull_request.base.ref }}
        PR_NUMBER: ${{ github.event.pull_request.number }}
        HEAD_SHA: ${{ github.event.pull_request.head.sha }}
      run: |
        git fetch --no-tags origin "refs/pull/${PR_NUMBER}/head:refs/remotes/origin/pr-head"
        git fetch --no-tags origin "$BASE_REF"
        test "$(git rev-parse refs/remotes/origin/pr-head)" = "$HEAD_SHA"
        git checkout --detach refs/remotes/origin/pr-head
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version-file: .tool-versions
    - id: impact
      uses: TroyAlford/basis/.github/actions/change-impact@<released-tag>
      with:
        base-ref: origin/${{ github.event.pull_request.base.ref }}
        head-sha: ${{ github.event.pull_request.head.sha }}
        config-path: .github/ci-impact.json
```

The head is fetched from the base repository's `refs/pull/<number>/head`, so a fork PR does not depend on fetching the fork repository from `origin`. The preflight verifies the fetched PR ref is the exact event head SHA before checking it out; the base branch is fetched separately for the merge base.

Composite-action outputs are step-scoped. A job that calls the action must republish every value consumed by another job as a job output; `needs.<job>.outputs.*` does not read `steps.<id>.outputs.*` automatically. The reference workflow also verifies the two evidence outputs are non-empty before the job succeeds, so a wiring mistake fails the preflight instead of silently skipping every suite.

The preflight does not install dependencies and does not execute PR code. Its one billed minute is disclosed in the recipe's before/after table; skipping a visual job that includes the pinned Playwright image pull is the saving that pays for it.

Downstream jobs must use the decision, not a fake success status:

```yaml
visual:
  needs: impact
  if: ${{ needs.impact.result == 'success' && !github.event.pull_request.draft && needs.impact.outputs.visual-needed == 'true' }}
```

The `Required` gate receives the decision and hash and accepts a skipped suite only when the decision records it as unaffected. See [required-gate](../required-gate/README.md).

## Limits

- The analyzer parses files; it never executes them. It does not follow symlinks, skips sources larger than 2 MB, and fails closed when the graph exceeds `maxGraphFiles`.
- It resolves relative imports, configured aliases, directory indexes, and static/dynamic import records. It does not evaluate arbitrary runtime module resolution; an unresolved or dynamic path is conservative.
- `selectedTests` is evidence, not permission to skip the rest of a suite. Setup, preloads and global state can create dependencies the file graph cannot see.
- A decision over the GitHub output limit fails the action rather than truncating. The full decision is still written to `impact-decision.json` for the artifact. The decision contains paths and reasons, not source contents, but GitHub's output size and redaction rules still apply.
- The policy and the action are trusted inputs. Pin the action to a released tag and keep the policy on the base branch.

## Local verification

```bash
bun .github/actions/change-impact/main.ts \
  --base-ref origin/main \
  --head-sha HEAD \
  --config-path .github/ci-impact.json
```

Add `--config-source head` only for local diagnostics when the policy is not on the base ref; the action always uses the base policy. The analyzer prints the decision; with `--output` it also writes `impact-decision.json`, and when `GITHUB_OUTPUT` is set it appends the action outputs.

The deterministic matrix lives in `.github/ci/impact.test.ts`; run `bun test ./.github/ci` or `bun run ci:contract`.
