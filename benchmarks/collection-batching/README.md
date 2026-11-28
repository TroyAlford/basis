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
| owner  | pre-#364      |  106 |     11 |      643.6 ms |  635.9–650.8 | 612.1 ms | 29.7 ms |      12,977 |
| owner  | #364 previous |  106 |      7 |       29.3 ms |    28.6–29.6 |  35.2 ms | 26.8 ms |       5,300 |
| owner  | flat current  |  106 |     11 |       12.4 ms |    12.1–13.8 |  14.6 ms |  8.1 ms |       1,498 |
| owner  | N7            |  106 |     11 |       12.6 ms |    10.9–13.0 |  11.6 ms |  7.6 ms |         853 |
| editor | pre-#364      |  106 |     11 |      750.4 ms |  723.7–778.5 | 710.0 ms | 28.2 ms |      36,167 |
| editor | #364 previous |  106 |      7 |      160.5 ms |  157.4–162.1 | 160.7 ms | 26.1 ms |      20,365 |
| editor | flat current  |  106 |     11 |       49.6 ms |    47.0–53.7 |  51.5 ms |  7.3 ms |       4,355 |
| editor | N7            |  106 |     11 |       56.9 ms |    54.8–58.7 |  48.2 ms |  6.6 ms |       3,712 |
| viewer | pre-#364      |  106 |     11 |      810.6 ms |  800.2–826.4 | 822.7 ms | 28.9 ms |      37,401 |
| viewer | #364 previous |  106 |      7 |      138.2 ms |  137.1–143.5 | 132.8 ms | 25.8 ms |      21,204 |
| viewer | flat current  |  106 |     11 |       50.5 ms |    46.3–51.9 |  50.1 ms |  7.8 ms |       4,560 |
| viewer | N7            |  106 |     11 |       49.2 ms |    46.7–49.5 |  46.5 ms |  6.8 ms |       3,915 |

Projected references now materialize only the reachable identities selected by their parent rows: root references share the selected-root set, and each nested reference source gets its own restricted CTE. That removes the broad `authorized_CustomCard`/`OfficialCard`/`Workspace`/`CardEdition`/`Art` scans from the previous head and reduces shared-buffer work for every actor. The owner and editor direct medians are at or below N7 in this run; the viewer median is within 1.3 ms. The generated statement is 88 `SELECT`s with 45 `AS MATERIALIZED` clauses (and 3 `row_number()` calls), versus N7's 35 and 19. The remaining syntactic difference is shared aggregation/authorization structure, not an unaddressed broad materialization. The multi-deck differential and selected-reachability scaling test both pass.

All actors saw the same requested nested shape: 106 root rows, 1 panel row, 106 deck rows, 106 deck-member rows, 106 deck-entry rows, and 106 card-face rows. `nested.json` records those counts. At this revision the current compiler’s `queryEntity` total (SQL plus mapping/hydration) had medians of 17.8 ms (owner), 62.1 ms (editor), and 54.0 ms (viewer). Subtracting the direct medians gives roughly 5.4 ms, 12.5 ms, and 3.5 ms of mapping/hydration work. These totals and the direct medians come from the same run and fixture.

## Policy observation

The captured plans use the canonical Graph RLS policies. The role check introduced by PR #363 is an uncorrelated scalar subquery, so PostgreSQL evaluates it once per role condition per statement. The current generated plan still contains many `basis.has_role` InitPlans because each policy predicate retains its own role check; nested child work dominates the remaining gap.

This PR also groups predicates by role inside one policy expression, so identical role checks can be shared when one target has multiple grants for the same role. It does not change the `SECURITY DEFINER` boundary, does not introduce a session cache, and does not disable or bypass RLS. A production policy cache would need a separately reviewed transaction-scoped actor-role contract; it is not included here.

## Parameter contract

Both the original and generated statements bind eleven independent inputs. The placeholder order differs because the flattened compiler emits the selected-root CTE first; `parameter-contract.json` records both ordered value arrays and the complete semantic position mapping so a caller can translate between them without collapsing any input. The generated page bindings are the direct offset and limit values in the item aggregate; the scope CTE reuses the same bound slots. The original used limit and offset, so the mapping is a pure permutation, not an arithmetic translation. The values and mapping are kept as review artifacts rather than silently reusing one filter for both item and matched-count domains.

## Count-domain reconciliation

Basis `$total` is the authorized population before query-time filtering. The uploaded MTG statement’s filtered `decks__total` was a reference defect, not a generic compiler rule; the compiler applies the Graph contract uniformly to every collection, and the checked-in N7 reference now projects a filtered matched count separately from an unfiltered total.

The multi-deck differential runs the consumer query against two visible decks for owner, editor, viewer, and a denied outsider. It keeps independent item and matched filters, uses a nonzero deck-entry offset, and compares raw and hydrated rows, `decks__matched`/`decks__total`, `deckEntries__matched`/`deckEntries__total`, and edge quantities with corrected N7. It is the acceptance check for the distinguishing case; the one-deck 106-root fixture alone cannot exercise it. `differential.json` records the result at Basis `2ff524f` and consumer `TroyAlford-AI/mtg-proxifier#e2bf27d`.

The consumer test is staged behind `BASIS_N7_COMPILER=1` because the production MTG dependency remains the released `basis` tag until an authorized upgrade. It asserts the linked Basis Git SHA with `BASIS_N7_EXPECTED_SHA`, uses the supported `basis/testing` compiler adapter, and skips without those development inputs:

```sh
BASIS_N7_COMPILER=1 \
BASIS_N7_EXPECTED_SHA=93e995df6b1d6b7b49799533042925136ac999ff \
bun test ./src/server/collectionN7.differential.integration.ts ./src/server/collectionN7.integration.ts
```

## Policy A/B

The A/B table below is historical evidence pinned to compiler `db116d4`; it is not a measurement of the current query. The later query-contract, pagination, and reachability work changed the SQL, so use the results table above for current performance.

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
