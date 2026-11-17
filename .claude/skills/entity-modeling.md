# entity-modeling

Use this skill when modeling a new association, navigation, or relationship record in a Basis Graph.

## Choose the shape

- **Entity**: independently identifiable, universal `Entity.id`, referenceable, polymorphic/inheritable, entity RLS.
- **Relationship**: composite endpoint identity, not referenceable, no inheritance, relationship-owned fields, relationship RLS.

Use an Entity when the thing has independent identity or must be the target of a reference. Use a Relationship when the record is defined by its endpoints and only needs to be navigated or queried as a relationship record.

## Relationship declarations

A relationship owns its physical table and endpoints. It does not own navigations.

```ts
{
  name: 'DeckCardPrinting',
  between: [
    { field: 'deck', target: 'Deck' },
    { field: 'card', target: 'Card' },
    { field: 'printing', target: 'Printing' },
  ],
  fields: [{ field: 'quantity', type: FieldType.Number }],
}
```

Declare every navigation on the Entity that exposes it with `type: FieldType.Collection`, an exact `target`, and an owner-relative `via` Graph path:

```ts
// Deck.fields
{ field: 'entries', type: FieldType.Collection, target: 'DeckCardPrinting', via: 'DeckCardPrinting[deck = @]' }
{ field: 'cards', type: FieldType.Collection, target: 'Card', via: 'entries.card' }
{ field: 'printings', type: FieldType.Collection, target: 'Printing', via: 'entries.printing' }

// Card.fields
{ field: 'decks', type: FieldType.Collection, target: 'Deck', via: 'DeckCardPrinting[card = @].deck' }
```

- `@` is the owning Entity identity.
- A `via` bracket filter uses full Graph predicate syntax and must identify the owner endpoint, for example `DeckCardPrinting[deck = @ $and quantity > 1]`. A collection alias can add another record filter, for example `largeEntries[quantity > 5].printing`.
- A `via` whose result is a relationship returns relationship records.
- A `via` whose result is an endpoint Entity returns that Entity.
- No reverse navigation is inferred; declare each direction separately.
- Collection fields create no tables or columns and are not written through mutations.
- Relationship records have no surrogate `id` and are not valid `Entity` reference targets.

## Query and writes

```ts
deck.entries
deck.entries[quantity > 1]
deck.cards
deck.entries[quantity > 1].card
deck.memberships $contains (user = $me $and role = 'Editor')
```

Relationship records support direct root reads and writes by required endpoint keys. Endpoint keys are identity and are not mutable through `edit`.

## Authorization

Authorize relationship records on the relationship itself. Use derived collection fields in entity policies when membership is the authorization fact. Do not introduce a surrogate relationship row id into policy SQL.

See [database](../../docs/server/database.mdx), [query language](../../docs/server/query-language.mdx), and [authorization](../../docs/server/authorization.mdx).
