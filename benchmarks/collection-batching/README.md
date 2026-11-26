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

| actor  | statement     | rows | params | direct median | direct range |  EXPLAIN |    plan | shared hits |
| ------ | ------------- | ---: | -----: | ------------: | -----------: | -------: | ------: | ----------: |
| owner | pre-#364 | 106 | 11 | 325.3 ms | 319.0–334.9 | 314.9 ms | 29.3 ms | 20,365 |
| owner | #364 previous | 106 | 7 | 163.8 ms | 162.5–168.5 | 194.2 ms | 27.2 ms | 9,061 |
| owner | flat current | 106 | 11 | 65.1 ms | 63.4–66.6 | 74.3 ms | 11.2 ms | 2,768 |
| owner | N7 | 106 | 11 | 50.4 ms | 50.1–51.1 | 53.1 ms | 7.5 ms | 1,703 |
| editor | pre-#364 | 106 | 11 | 515.7 ms | 502.5–535.8 | 505.8 ms | 29.3 ms | 39,647 |
| editor | #364 previous | 106 | 7 | 321.1 ms | 303.1–328.2 | 322.0 ms | 26.1 ms | 22,284 |
| editor | flat current | 106 | 11 | 122.1 ms | 117.3–126.8 | 113.1 ms | 10.7 ms | 5,937 |
| editor | N7 | 106 | 11 | 88.1 ms | 78.7–93.3 | 82.9 ms | 6.4 ms | 4,241 |
| viewer | pre-#364 | 106 | 11 | 467.3 ms | 466.1–513.2 | 457.6 ms | 28.0 ms | 40,879 |
| viewer | #364 previous | 106 | 7 | 303.4 ms | 302.1–310.8 | 361.7 ms | 25.8 ms | 23,123 |
| viewer | flat current | 106 | 11 | 129.1 ms | 123.2–143.1 | 141.4 ms | 10.6 ms | 6,135 |
| viewer | N7 | 106 | 11 | 84.5 ms | 82.3–132.1 | 83.9 ms | 6.5 ms | 4,444 |

The flattened plan is materially faster than pre-#364 and close to N7, while leaving selected roots and target relations inline so authorization work can narrow before broad scans. The remaining gap is the price of that scaling-safe choice.

All actors saw the same requested nested shape: 106 root rows, 1 panel row, 106 deck rows, 106 deck-member rows, 106 deck-entry rows, and 106 card-face rows. `nested.json` records those counts. The current compiler’s `queryEntity` total (SQL plus mapping/hydration) had medians of 76.1 ms (owner), 150.0 ms (editor), and 130.9 ms (viewer); subtracting the direct SQL medians gives roughly 2.7 ms, 25.8 ms, and 1.3 ms of mapping/hydration work.

## Policy observation

The captured plans use the canonical Graph RLS policies. The role check introduced by PR #363 is an uncorrelated scalar subquery, so PostgreSQL evaluates it once per role condition per statement. The current generated plan still contains many `basis.has_role` InitPlans because each policy predicate retains its own role check; nested child work dominates the remaining gap.

This PR also groups predicates by role inside one policy expression, so identical role checks can be shared when one target has multiple grants for the same role. It does not change the `SECURITY DEFINER` boundary, does not introduce a session cache, and does not disable or bypass RLS. A production policy cache would need a separately reviewed transaction-scoped actor-role contract; it is not included here.

## Parameter contract

Both the original and generated statements bind eleven independent inputs. The placeholder order differs because the flattened compiler emits the selected-root CTE first; `parameter-contract.json` records both ordered value arrays and the complete semantic position mapping so a caller can translate between them without collapsing any input. The generated page bindings are the direct offset and limit values in the item aggregate; the scope CTE reuses the same bound slots. The original used limit and offset, so the mapping is a pure permutation, not an arithmetic translation. The values and mapping are kept as review artifacts rather than silently reusing one filter for both item and matched-count domains.

## Count-domain reconciliation

Basis `$total` is the authorized population before query-time filtering. The uploaded MTG statement’s filtered `decks__total` was a reference defect, not a generic compiler rule; the compiler applies the Graph contract uniformly to every collection, and the checked-in N7 reference now projects a filtered matched count separately from an unfiltered total. This makes the multiple-deck case observable and equivalent.

## Policy A/B

Policy A/B measurements are pinned to commit `db116d4`; the later query-contract and pagination work changes no policy SQL.

The grouped-policy variant is the only policy change in this PR: predicates for the same role are factored under one role check. It was applied to the disposable fixture schema by replacing the installed policies with the current Graph policy SQL; the table structures and data were unchanged. The canonical and grouped runs used the same actor, fixture, statements, warm-up, and five direct repetitions.

| actor  | statement    | canonical median | grouped median | canonical EXPLAIN | grouped EXPLAIN |
| ------ | ------------ | ---------------: | -------------: | ----------------: | --------------: |
| owner  | #364 current |          83.2 ms |        24.0 ms |           83.3 ms |         24.4 ms |
| owner  | N7           |          64.8 ms |        12.3 ms |           65.3 ms |         11.3 ms |
| editor | #364 current |         153.3 ms |        67.6 ms |          139.4 ms |         66.7 ms |
| editor | N7           |         121.8 ms |        48.9 ms |          115.3 ms |         53.7 ms |
| viewer | #364 current |         134.0 ms |        70.3 ms |          144.1 ms |         70.9 ms |
| viewer | N7           |         109.8 ms |        50.2 ms |          113.2 ms |         49.5 ms |

A hydrated comparison across owner, editor, viewer, anonymous, and nonmember actors returned identical requested fields and nested collections before and after the policy replacement; allowed actors had 106 rows, anonymous and nonmember had 0, and the old and new policy sets both contained 120 policy objects. `policy-verification.json` records the check. The grouped variant preserves the existing `basis.has_role` `SECURITY DEFINER` function, actor-setting contract, and fail-closed behavior. It does not add a session cache, does not disable RLS, and does not change privilege boundaries. The result is a measured policy-compilation improvement, not the experimental inline membership/R configuration.

## Policy diagnostic

The following is a **diagnostic floor only**, not product behavior and not a proposed policy. It runs the same statements and fixture with `RESET ROLE` immediately before the no-RLS measurement, on the same connection and actor setting; the application-role measurement is the canonical policy. The role switch changes planner state as well as RLS visibility, so the two columns are not a controlled estimate of policy cost.

| actor  | statement    | app-role median | app EXPLAIN | no-RLS median | no-RLS EXPLAIN |
| ------ | ------------ | --------------: | ----------: | ------------: | -------------: |
| owner  | #364 current |        240.4 ms |    208.8 ms |       18.7 ms |        20.6 ms |
| owner  | N7           |         77.5 ms |     67.9 ms |        8.1 ms |         7.6 ms |
| viewer | #364 current |        256.9 ms |    297.6 ms |       18.9 ms |        21.5 ms |
| viewer | N7           |        113.7 ms |    106.2 ms |        7.7 ms |         8.1 ms |

The diagnostic shows that authorization and the broader generated plan jointly dominate the application-role result. It does not establish a safe production policy replacement. The only policy change included in this PR is predicate grouping by role inside one policy expression, covered by `Graph > shares one role subquery across predicates for the same role`; it preserves the existing `basis.has_role` `SECURITY DEFINER` boundary, actor-setting contract, and fail-closed behavior.
