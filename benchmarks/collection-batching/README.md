# Collection batching benchmark

This directory records the Phase 3 collection-batching comparison against the MTG 106-printing fixture. It is evidence, not a public API or a production benchmark suite.

## Fixture and method

- Graph: MTG canonical `graph.ts`.
- Fixture: MTG `databaseFixture` plus 105 generated `CustomPrinting` rows and their `DeckPrinting` edges, for 106 root printings.
- Execution: the supported app-role database fixture, in one transaction, under the same actor settings.
- Actors: owner, editor, and viewer. Each has read access to the deck and all 106 printings.
- Statements:
  - `pre364.sql`: compiler at `ecb57a4` (PR #363 base, before collection batching).
  - `364-previous.sql`: compiler at `63039d1` (nested batching added, but nested owner domains still selected all authorized parent rows).
  - `364-current.sql`: compiler in this PR (shared selected-root and transitive parent-selection CTEs).
  - `n7.sql`: corrected hand-written N7 candidate.
- Each statement was warmed once per actor, then five direct executions were run in randomized interleaved order. `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, VERBOSE, FORMAT JSON)` was captured separately.
- `summary.json` contains root rows, the five direct timings, planning/execution time, shared hit/read blocks, estimated versus actual rows, and the top plan nodes by actual total time.
- `*-*.json.gz` are the complete `FORMAT JSON` plans from the run. Decompress with `gunzip -c`.

All statements returned 106 root rows for every actor. The planner estimated one root row in every captured plan. `semantics.json` records the hydrated parity check against the requested MTG fields: `pre364`, `previous`, and `current` each have zero mismatches for owner, editor, and viewer when compared with the N7 result (106 rows per actor).

## Results

Direct times are the median of five interleaved runs; ranges are min–max.

| actor | statement | rows | direct median | direct range | EXPLAIN | plan | shared hits |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| owner | pre-#364 | 106 | 318.2 ms | 312.1–337.3 | 298.0 ms | 27.1 ms | 20,365 |
| owner | #364 previous | 106 | 146.6 ms | 143.7–148.2 | 159.1 ms | 25.8 ms | 9,061 |
| owner | #364 current | 106 | 118.9 ms | 117.3–120.8 | 134.9 ms | 27.6 ms | 7,780 |
| owner | N7 | 106 | 50.4 ms | 49.3–51.0 | 52.0 ms | 7.1 ms | 1,703 |
| editor | pre-#364 | 106 | 477.6 ms | 464.6–502.6 | 446.5 ms | 27.3 ms | 39,647 |
| editor | #364 previous | 106 | 290.4 ms | 286.8–312.5 | 256.2 ms | 24.7 ms | 22,284 |
| editor | #364 current | 106 | 227.8 ms | 222.2–241.3 | 234.1 ms | 24.7 ms | 18,564 |
| editor | N7 | 106 | 81.7 ms | 79.1–87.2 | 72.1 ms | 6.4 ms | 4,241 |
| viewer | pre-#364 | 106 | 440.0 ms | 425.0–442.9 | 410.9 ms | 26.4 ms | 40,879 |
| viewer | #364 previous | 106 | 261.3 ms | 257.1–264.2 | 285.4 ms | 24.6 ms | 23,123 |
| viewer | #364 current | 106 | 202.2 ms | 198.9–204.1 | 217.0 ms | 23.9 ms | 19,193 |
| viewer | N7 | 106 | 76.3 ms | 74.2–83.0 | 76.2 ms | 6.2 ms | 4,444 |

The changed nested scope reduced shared-buffer work for all three actors and reduced direct latency for owner, editor, and viewer relative to the previous #364 compiler. N7 remains substantially faster; this PR does not claim N7 parity.

## Policy observation

The captured plans use the canonical Graph RLS policies. The role check introduced by PR #363 is an uncorrelated scalar subquery, so PostgreSQL evaluates it once per role condition per statement. The current generated plan still contains many `basis.has_role` InitPlans because each policy predicate retains its own role check; nested child work dominates the remaining gap.

This PR also groups predicates by role inside one policy expression, so identical role checks can be shared when one target has multiple grants for the same role. It does not change the `SECURITY DEFINER` boundary, does not introduce a session cache, and does not disable or bypass RLS. A production policy cache would need a separately reviewed transaction-scoped actor-role contract; it is not included here.

## Policy A/B

The grouped-policy variant is the only policy change in this PR: predicates for the same role are factored under one role check. It was applied to the disposable fixture schema by replacing the installed policies with the current Graph policy SQL; the table structures and data were unchanged. The canonical and grouped runs used the same actor, fixture, statements, warm-up, and five direct repetitions.

| actor | statement | canonical median | grouped median | canonical EXPLAIN | grouped EXPLAIN |
| --- | --- | ---: | ---: | ---: | ---: |
| owner | #364 current | 200.9 ms | 30.0 ms | 197.3 ms | 34.8 ms |
| owner | N7 | 48.2 ms | 10.5 ms | 51.5 ms | 11.1 ms |
| editor | #364 current | 317.6 ms | 118.6 ms | 284.0 ms | 121.9 ms |
| editor | N7 | 94.4 ms | 41.7 ms | 97.6 ms | 42.2 ms |
| viewer | #364 current | 277.5 ms | 121.4 ms | 293.9 ms | 130.6 ms |
| viewer | N7 | 85.8 ms | 39.4 ms | 94.0 ms | 39.2 ms |

A hydrated comparison across owner, editor, viewer, anonymous, and nonmember actors returned identical requested fields and nested collections before and after the policy replacement; allowed actors had 106 rows, anonymous and nonmember had 0, and the old and new policy sets both contained 120 policy objects. `policy-verification.json` records the check. The grouped variant preserves the existing `basis.has_role` `SECURITY DEFINER` function, actor-setting contract, and fail-closed behavior. It does not add a session cache, does not disable RLS, and does not change privilege boundaries. The result is a measured policy-compilation improvement, not the experimental inline membership/R configuration.

## Policy diagnostic

The following is a **diagnostic floor only**, not product behavior and not a proposed policy. It runs the same statements and fixture with `RESET ROLE` immediately before the no-RLS measurement, on the same connection and actor setting; the application-role measurement is the canonical policy. The role switch changes planner state as well as RLS visibility, so the two columns are not a controlled estimate of policy cost.

| actor | statement | app-role median | app EXPLAIN | no-RLS median | no-RLS EXPLAIN |
| --- | --- | ---: | ---: | ---: | ---: |
| owner | #364 current | 240.4 ms | 208.8 ms | 18.7 ms | 20.6 ms |
| owner | N7 | 77.5 ms | 67.9 ms | 8.1 ms | 7.6 ms |
| viewer | #364 current | 256.9 ms | 297.6 ms | 18.9 ms | 21.5 ms |
| viewer | N7 | 113.7 ms | 106.2 ms | 7.7 ms | 8.1 ms |

The diagnostic shows that authorization and the broader generated plan jointly dominate the application-role result. It does not establish a safe production policy replacement. The only policy change included in this PR is predicate grouping by role inside one policy expression, covered by `Graph > shares one role subquery across predicates for the same role`; it preserves the existing `basis.has_role` `SECURITY DEFINER` boundary, actor-setting contract, and fail-closed behavior.
