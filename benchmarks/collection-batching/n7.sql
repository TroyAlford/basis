-- Candidate A: batch, set-oriented replacement for the uploaded CustomPrinting query.
-- PostgreSQL. Preserve the original eleven bound values in their original positions.
-- $1/$2: nested deck member limit/offset
-- $3: nested decks item filter; $4/$5: nested decks limit/offset
-- $6: nested decks matched-count filter
-- $7: nested deckEntries item filter; $8/$9: entry limit/offset
-- $10: deckEntries matched-count filter
-- $11: root deck selector
-- Important: $3/$6/$7/$10/$11 are intentionally distinct; do not assume
-- they are identical until the production parameter array has been inspected.
-- Assumes unique ArtTag (art.id, tag.id) and DeckMembership (deck.id, user.id)
-- edges, as the original scalar __edge lookups also assume uniqueness.
-- Use nonnegative pagination limits/offsets as in the application.
-- Execute under the same actor, application role, RLS context, and transaction
-- as the original query. No session-wide RLS bypass or SECURITY DEFINER.
WITH
-- Scope the full operation to the requested, RLS-readable deck first.
target_deck AS MATERIALIZED (
  SELECT deck."id"
  FROM "Deck" AS deck
  JOIN "Entity" AS root ON root."id" = deck."id"
  WHERE deck."id" IS NOT DISTINCT FROM $11
),
selected_printing_ids AS MATERIALIZED (
  SELECT DISTINCT edge."printing.id" AS id
  FROM target_deck AS deck
  JOIN "DeckPrinting" AS edge ON edge."deck.id" = deck."id"
),
printings AS MATERIALIZED (
  SELECT
    printing."id",
    base."card.id" AS card_id,
    printing."workspace.id" AS workspace_id,
    printing."edition.id" AS edition_id,
    printing."sourceProvider",
    printing."sourceId",
    printing."revision",
    printing."document",
    printing."createdAt",
    printing."updatedAt"
  FROM selected_printing_ids AS selected
  JOIN "CustomPrinting" AS printing ON printing."id" = selected.id
  JOIN "Printing" AS base ON base."id" = printing."id"
  JOIN "Entity" AS root ON root."id" = printing."id"
),
-- Card faces: one authorized input and one grouped JSON/count pass per card.
selected_card_ids AS MATERIALIZED (
  SELECT DISTINCT card_id AS id
  FROM printings
  WHERE card_id IS NOT NULL
),
-- Each concrete type still passes through its RLS-protected leaf.
visible_cards AS MATERIALIZED (
  SELECT card."id", root."entity", root."name", card."colorIdentity",
         custom."sourceProvider", custom."workspace.id" AS workspace_id
  FROM selected_card_ids AS selected
  JOIN "CustomCard" AS custom ON custom."id" = selected.id
  JOIN "Card" AS card ON card."id" = custom."id"
  JOIN "Entity" AS root ON root."id" = custom."id"
  UNION ALL
  SELECT card."id", root."entity", root."name", card."colorIdentity",
         NULL AS "sourceProvider", NULL AS workspace_id
  FROM selected_card_ids AS selected
  JOIN "OfficialCard" AS official ON official."id" = selected.id
  JOIN "Card" AS card ON card."id" = official."id"
  JOIN "Entity" AS root ON root."id" = official."id"
),
selected_workspace_ids AS MATERIALIZED (
  SELECT DISTINCT workspace_id AS id
  FROM printings
  WHERE workspace_id IS NOT NULL
  UNION
  SELECT DISTINCT workspace_id AS id
  FROM visible_cards
  WHERE workspace_id IS NOT NULL
),
visible_workspaces AS MATERIALIZED (
  SELECT workspace."id", root."name"
  FROM selected_workspace_ids AS selected
  JOIN "Workspace" AS workspace ON workspace."id" = selected.id
  JOIN "Entity" AS root ON root."id" = workspace."id"
),
selected_edition_ids AS MATERIALIZED (
  SELECT DISTINCT edition_id AS id
  FROM printings
  WHERE edition_id IS NOT NULL
),
visible_editions AS MATERIALIZED (
  SELECT edition."id", root."name", edition."edition"
  FROM selected_edition_ids AS selected
  JOIN "CardEdition" AS edition ON edition."id" = selected.id
  JOIN "Entity" AS root ON root."id" = edition."id"
),
card_face_rows AS (
  SELECT face."card.id" AS card_id, face."id", root."name", root."entity",
         face."position", face."layout", face."colorOverride", face."colors",
         face."loyalty", face."manaCost", face."oracleText", face."power",
         face."subtypes", face."supertypes", face."toughness",
         face."typeLine", face."types"
  FROM selected_card_ids AS card
  JOIN "CardFace" AS face ON face."card.id" = card.id
  JOIN "Entity" AS root ON root."id" = face."id"
),
card_faces AS (
  SELECT card_id,
         json_agg(json_build_object(
           'id', id, 'name', "name", 'entity', "entity",
           'position', "position", 'layout', "layout",
           'colorOverride', "colorOverride", 'colors', "colors",
           'loyalty', "loyalty", 'manaCost', "manaCost",
           'oracleText', "oracleText", 'power', "power",
           'subtypes', "subtypes", 'supertypes', "supertypes",
           'toughness', "toughness", 'typeLine', "typeLine", 'types', "types"
         ) ORDER BY id) AS items,
         count(*)::int AS matched
  FROM card_face_rows
  GROUP BY card_id
),
-- The visible panels for *all* deck printings, built once.
panels_base AS MATERIALIZED (
  SELECT panel."printing.id" AS printing_id,
         panel."id", root."name", root."entity", panel."position",
         panel."rotation", panel."design", panel."image", panel."artist",
         panel."border", panel."form", panel."framing",
         art."id" AS art_id, art_root."name" AS art_name,
         art."artist" AS art_artist, art."imageUrl" AS art_image_url,
         owner."id" AS art_owner_id, owner_root."name" AS art_owner_name
  FROM printings AS printing
  JOIN "PrintingPanel" AS panel ON panel."printing.id" = printing."id"
  JOIN "Entity" AS root ON root."id" = panel."id"
  LEFT JOIN "Art" AS art ON art."id" = panel."art.id"
  LEFT JOIN "Entity" AS art_root ON art_root."id" = art."id"
  LEFT JOIN "User" AS owner ON owner."id" = art."owner.id"
  LEFT JOIN "Entity" AS owner_root ON owner_root."id" = owner."id"
),
-- Face membership: one relationship join instead of two EXISTS probes per face.
panel_face_rows AS (
  SELECT DISTINCT panel."id" AS panel_id,
         face."id", root."name", root."entity"
  FROM panels_base AS panel
  JOIN "PrintingPanelFace" AS link ON link."panel.id" = panel."id"
  JOIN "CardFace" AS face ON face."id" = link."face.id"
  JOIN "Entity" AS root ON root."id" = face."id"
),
panel_faces AS (
  SELECT panel_id,
         json_agg(json_build_object(
           'id', id, 'name', "name", 'entity', "entity"
         ) ORDER BY id) AS items,
         count(*)::int AS matched
  FROM panel_face_rows
  GROUP BY panel_id
),
selected_art_ids AS MATERIALIZED (
  SELECT DISTINCT art_id AS id FROM panels_base WHERE art_id IS NOT NULL
),
art_tag_rows AS (
  SELECT link."art.id" AS art_id, tag."id", root."name", root."entity",
         tag."slug", link."source"
  FROM selected_art_ids AS art
  JOIN "ArtTag" AS link ON link."art.id" = art.id
  JOIN "Tag" AS tag ON tag."id" = link."tag.id"
  JOIN "Entity" AS root ON root."id" = tag."id"
),
art_tags AS (
  SELECT art_id,
         json_agg(json_build_object(
           'id', id, 'name', "name", 'entity', "entity", 'slug', "slug",
           '__edge', json_build_object('source', "source")
         ) ORDER BY id) AS items,
         count(*)::int AS matched
  FROM art_tag_rows
  GROUP BY art_id
),
panels AS (
  SELECT panel.printing_id,
         json_agg(json_build_object(
           'id', panel."id", 'name', panel."name", 'entity', panel."entity",
           'position', panel."position",
           'art__entity', 'Art',
           'art__id', panel.art_id, 'art__name', panel.art_name,
           'rotation', panel."rotation", 'design', panel."design",
           'image', panel."image", 'artist', panel."artist",
           'border', panel."border", 'form', panel."form",
           'framing', panel."framing",
           'art__artist', panel.art_artist,
           'art__imageUrl', panel.art_image_url,
           'art__owner__entity', 'User',
           'art__owner__id', panel.art_owner_id,
           'art__owner__name', panel.art_owner_name,
           'faces', COALESCE(faces.items, '[]'::json),
           'faces__matched', COALESCE(faces.matched, 0),
           'art__tagLinks', COALESCE(tags.items, '[]'::json),
           'art__tagLinks__matched', COALESCE(tags.matched, 0)
         ) ORDER BY panel."id") AS items,
         count(*)::int AS matched
  FROM panels_base AS panel
  LEFT JOIN panel_faces AS faces ON faces.panel_id = panel."id"
  LEFT JOIN art_tags AS tags ON tags.art_id = panel.art_id
  GROUP BY panel.printing_id
),
-- One RLS-visible collection of relationship rows for the selected printings.
deck_entries_base AS MATERIALIZED (
  SELECT link."printing.id" AS printing_id,
         link."deck.id" AS deck_id,
         link."quantity"
  FROM printings AS printing
  JOIN "DeckPrinting" AS link ON link."printing.id" = printing."id"
),
deck_entry_counts AS (
  SELECT printing_id,
         count(*) FILTER (WHERE deck_id IS NOT DISTINCT FROM $10)::int AS matched,
         count(*)::int AS total
  FROM deck_entries_base
  GROUP BY printing_id
),
deck_entry_ranked AS (
  SELECT entry.*,
         row_number() OVER (
           PARTITION BY printing_id ORDER BY deck_id, printing_id
         ) AS ordinal
  FROM deck_entries_base AS entry
  WHERE deck_id IS NOT DISTINCT FROM $7
),
deck_entry_items AS (
  SELECT printing_id,
         json_agg(json_build_object(
           'quantity', "quantity", 'deck', deck_id, 'printing', printing_id
         ) ORDER BY deck_id, printing_id) AS items
  FROM deck_entry_ranked
  WHERE ordinal > COALESCE($9::bigint, 0)
    AND ($8::bigint IS NULL OR ordinal <= COALESCE($9::bigint, 0) + $8::bigint)
  GROUP BY printing_id
),
-- A printing can appear in several decks. Keep only RLS-readable decks.
selected_deck_ids AS MATERIALIZED (
  SELECT DISTINCT deck_id AS id
  FROM deck_entries_base
),
visible_decks AS MATERIALIZED (
  SELECT deck."id", root."name", root."entity",
         deck."revision", deck."createdAt", deck."updatedAt",
         deck."createdBy.id" AS creator_id,
         creator_root."name" AS creator_name
  FROM selected_deck_ids AS selected
  JOIN "Deck" AS deck ON deck."id" = selected.id
  JOIN "Entity" AS root ON root."id" = deck."id"
  LEFT JOIN "User" AS creator ON creator."id" = deck."createdBy.id"
  LEFT JOIN "Entity" AS creator_root ON creator_root."id" = creator."id"
),
printing_decks AS MATERIALIZED (
  SELECT DISTINCT
         entry.printing_id,
         deck."id" AS deck_id, deck."name", deck."entity",
         deck."revision", deck."createdAt", deck."updatedAt",
         deck.creator_id, deck.creator_name
  FROM deck_entries_base AS entry
  JOIN visible_decks AS deck ON deck."id" = entry.deck_id
),
deck_counts AS (
  SELECT printing_id,
         count(*) FILTER (WHERE deck_id IS NOT DISTINCT FROM $6)::int AS matched,
         count(*)::int AS total
  FROM printing_decks
  GROUP BY printing_id
),
selected_deck_rows AS MATERIALIZED (
  SELECT deck.*
  FROM printing_decks AS deck
  WHERE deck_id IS NOT DISTINCT FROM $3
    AND COALESCE($5::bigint, 0) = 0
    AND ($4::bigint IS NULL OR $4::bigint > 0)
),
-- Deck memberships are evaluated for selected deck items only.
selected_member_deck_ids AS MATERIALIZED (
  SELECT DISTINCT deck_id AS id FROM selected_deck_rows
),
member_rows AS MATERIALIZED (
  SELECT member."deck.id" AS deck_id,
         user_row."id" AS user_id, root."name", root."entity",
         member."role"
  FROM selected_member_deck_ids AS deck
  JOIN "DeckMembership" AS member ON member."deck.id" = deck.id
  JOIN "User" AS user_row ON user_row."id" = member."user.id"
  JOIN "Entity" AS root ON root."id" = user_row."id"
),
member_counts AS (
  SELECT deck_id,
         count(*) FILTER (WHERE user_id IS NOT DISTINCT FROM
           NULLIF(current_setting('actor.id', TRUE), ''))::int AS matched,
         count(*)::int AS total
  FROM member_rows
  GROUP BY deck_id
),
member_items AS (
  SELECT member.deck_id,
         json_build_array(json_build_object(
           'id', member.user_id,
           'name', member."name",
           'entity', member."entity",
           '__edge', json_build_object('role', member."role")
         )) AS items
  FROM member_rows AS member
  WHERE member.user_id IS NOT DISTINCT FROM
        NULLIF(current_setting('actor.id', TRUE), '')
    AND COALESCE($2::bigint, 0) = 0
    AND ($1::bigint IS NULL OR $1::bigint > 0)
),
selected_deck_items AS MATERIALIZED (
  SELECT deck.printing_id,
         json_build_array(json_build_object(
           'id', deck.deck_id, 'name', deck."name", 'entity', deck."entity",
           'revision', deck."revision",
           'createdAt', deck."createdAt", 'updatedAt', deck."updatedAt",
           'createdBy__entity', 'User',
           'createdBy__id', deck.creator_id, 'createdBy__name', deck.creator_name,
           'members', COALESCE(members.items, '[]'::json),
           'members__matched', COALESCE(member_counts.matched, 0),
           'members__total', COALESCE(member_counts.total, 0)
         )) AS items
  FROM selected_deck_rows AS deck
  LEFT JOIN member_items AS members ON members.deck_id = deck.deck_id
  LEFT JOIN member_counts ON member_counts.deck_id = deck.deck_id
)
SELECT
  printing."id" AS "id",
  card."entity" AS "card__entity",
  card."id" AS "card__id",
  card."name" AS "card__name",
  'Workspace' AS "workspace__entity",
  workspace."id" AS "workspace__id",
  workspace."name" AS "workspace__name",
  printing."sourceProvider" AS "sourceProvider",
  printing."sourceId" AS "sourceId",
  printing."revision" AS "revision",
  printing."document" AS "document",
  'CardEdition' AS "edition__entity",
  edition."id" AS "edition__id",
  edition."name" AS "edition__name",
  edition."edition" AS "edition__edition",
  printing."createdAt" AS "createdAt",
  printing."updatedAt" AS "updatedAt",
  card."colorIdentity" AS "card__colorIdentity",
  CASE WHEN card."entity" = 'CustomCard'
       THEN card."sourceProvider" ELSE NULL END AS "card__sourceProvider",
  'Workspace' AS "card__workspace__v0__entity",
  card_workspace."id" AS "card__workspace__v0__id",
  card_workspace."name" AS "card__workspace__v0__name",
  COALESCE(panels.items, '[]'::json) AS "panels",
  COALESCE(panels.matched, 0) AS "panels__matched",
  COALESCE(decks.items, '[]'::json) AS "decks",
  COALESCE(deck_counts.matched, 0) AS "decks__matched",
  COALESCE(deck_counts.total, 0) AS "decks__total",
  COALESCE(deck_entries.items, '[]'::json) AS "deckEntries",
  COALESCE(deck_entry_counts.matched, 0) AS "deckEntries__matched",
  COALESCE(deck_entry_counts.total, 0) AS "deckEntries__total",
  COALESCE(faces.items, '[]'::json) AS "card__faces",
  COALESCE(faces.matched, 0) AS "card__faces__matched"
FROM printings AS printing
LEFT JOIN visible_cards AS card ON card."id" = printing.card_id
LEFT JOIN visible_workspaces AS workspace ON workspace."id" = printing.workspace_id
LEFT JOIN visible_editions AS edition ON edition."id" = printing.edition_id
LEFT JOIN visible_workspaces AS card_workspace ON card_workspace."id" = card.workspace_id
LEFT JOIN panels ON panels.printing_id = printing."id"
LEFT JOIN selected_deck_items AS decks ON decks.printing_id = printing."id"
LEFT JOIN deck_counts ON deck_counts.printing_id = printing."id"
LEFT JOIN deck_entry_items AS deck_entries ON deck_entries.printing_id = printing."id"
LEFT JOIN deck_entry_counts ON deck_entry_counts.printing_id = printing."id"
LEFT JOIN card_faces AS faces ON faces.card_id = card."id"
ORDER BY printing."id";
