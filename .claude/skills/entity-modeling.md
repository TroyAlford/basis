# entity-modeling

Use this skill when modeling a new association, navigation, or relationship record in a Basis Graph.

## Choose the shape

- **Entity**: independently identifiable, universal `Entity.id`, referenceable, polymorphic/inheritable, entity RLS.
- **Relationship**: composite endpoint identity, not referenceable, no inheritance, relationship-owned fields, relationship RLS.

Use an Entity when the thing has independent identity or must be the target of a reference. Use a Relationship when the record is defined by its endpoints and only needs to be navigated or queried as a relationship record.

## Relationship declarations

An endpoint may expose a related-entity navigation with `inverse`, the relationship records with `collection`, or neither. Both are explicit; no reverse navigation is inferred.

```ts
{
  name: 'DeckMembership',
  between: [
    {
      collection: 'memberships',
      field: 'deck',
      inverse: 'members',
      target: 'Deck',
    },
    {
      collection: 'deckMemberships',
      field: 'user',
      inverse: 'decks',
      target: 'User',
    },
  ],
  fields: [{ field: 'role', type: 'String' }],
}
```

- `inverse` is available only for two-endpoint relationships.
- `collection` exposes relationship records and works for two or more endpoints.
- Endpoint fields form the composite identity; relationship records have no surrogate `id`.
- Do not add an `Entity` root, `name`, `entity`, or universal reference to a relationship record.

## Query and writes

```ts
deck.members
deck.memberships
deck.memberships[role = 'Editor'].user
deck.memberships $contains (user = $me $and role = 'Editor')
```

Relationship records support direct root reads and writes by required endpoint keys. Endpoint keys are identity and are not mutable through `edit`.

## Authorization

Authorize relationship records on the relationship itself. Use relationship-record collections in entity policies when membership is the authorization fact. Do not introduce a surrogate relationship row id into policy SQL.

See [database](../../docs/server/database.mdx), [query language](../../docs/server/query-language.mdx), and [authorization](../../docs/server/authorization.mdx).
