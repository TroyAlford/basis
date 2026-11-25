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
| owner | pre-#364 | 106 | 316.4 ms | 315.0–330.4 | 292.0 ms | 27.0 ms | 20,365 |
| owner | #364 previous | 106 | 159.3 ms | 157.2–163.3 | 170.8 ms | 25.1 ms | 9,061 |
| owner | #364 current | 106 | 57.3 ms | 55.5–67.8 | 56.3 ms | 5.9 ms | 1,498 |
| owner | N7 | 106 | 60.6 ms | 59.6–61.4 | 63.7 ms | 6.6 ms | 1,703 |
| editor | pre-#364 | 106 | 469.2 ms | 463.0–514.5 | 460.5 ms | 27.1 ms | 39,647 |
| editor | #364 previous | 106 | 320.6 ms | 306.2–328.6 | 291.2 ms | 24.4 ms | 22,284 |
| editor | #364 current | 106 | 111.7 ms | 108.8–115.4 | 107.9 ms | 5.7 ms | 4,773 |
| editor | N7 | 106 | 117.2 ms | 113.6–123.3 | 97.1 ms | 6.4 ms | 4,241 |
| viewer | pre-#364 | 106 | 439.6 ms | 435.8–658.6 | 415.7 ms | 26.8 ms | 40,879 |
| viewer | #364 previous | 106 | 298.6 ms | 295.9–425.9 | 320.2 ms | 24.3 ms | 23,123 |
| viewer | #364 current | 106 | 116.8 ms | 114.4–125.2 | 115.9 ms | 5.5 ms | 4,980 |
| viewer | N7 | 106 | 110.5 ms | 105.2–113.5 | 107.5 ms | 6.2 ms | 4,444 |

The flattened plan matches or beats N7 for owner and editor and is within roughly 6% for viewer on this fixture, with comparable shared-buffer work. The before/after comparison is against the pre-flat #364 plan, not against a production release.

All actors saw the same requested nested shape: 106 root rows, 1 panel row, 106 deck rows, 106 deck-member rows, 106 deck-entry rows, and 106 card-face rows. `nested.json` records those counts. The current compiler’s `queryEntity` total (SQL plus mapping/hydration) had medians of 59.0 ms (owner), 122.6 ms (editor), and 146.8 ms (viewer); subtracting the direct SQL medians gives roughly 1.7 ms, 10.9 ms, and 30.0 ms of mapping/hydration work.

## Policy observation

The captured plans use the canonical Graph RLS policies. The role check introduced by PR #363 is an uncorrelated scalar subquery, so PostgreSQL evaluates it once per role condition per statement. The current generated plan still contains many `basis.has_role` InitPlans because each policy predicate retains its own role check; nested child work dominates the remaining gap.

This PR also groups predicates by role inside one policy expression, so identical role checks can be shared when one target has multiple grants for the same role. It does not change the `SECURITY DEFINER` boundary, does not introduce a session cache, and does not disable or bypass RLS. A production policy cache would need a separately reviewed transaction-scoped actor-role contract; it is not included here.

## Policy A/B

The grouped-policy variant is the only policy change in this PR: predicates for the same role are factored under one role check. It was applied to the disposable fixture schema by replacing the installed policies with the current Graph policy SQL; the table structures and data were unchanged. The canonical and grouped runs used the same actor, fixture, statements, warm-up, and five direct repetitions.

| actor | statement | canonical median | grouped median | canonical EXPLAIN | grouped EXPLAIN |
| --- | --- | ---: | ---: | ---: | ---: |
| owner | #364 current | 207.5 ms | 29.0 ms | 178.9 ms | 33.4 ms |
| owner | N7 | 48.9 ms | 10.4 ms | 52.1 ms | 11.1 ms |
| editor | #364 current | 281.7 ms | 114.8 ms | 254.1 ms | 130.1 ms |
| editor | N7 | 96.3 ms | 36.8 ms | 89.2 ms | 37.1 ms |
| viewer | #364 current | 260.2 ms | 111.3 ms | 299.0 ms | 128.1 ms |
| viewer | N7 | 85.6 ms | 37.5 ms | 87.4 ms | 40.4 ms |

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
