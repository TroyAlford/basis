import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EntityDefinitions } from '../../../libraries/server/source/EntityDefinitions'

/** The deterministic model used by the large PostgreSQL fixture. */
const seedEntities = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'Snowflake' },
        { field: 'nickname', type: 'String' },
      ],
      name: 'Pet',
    },
    {
      extends: 'Pet',
      fields: [{ field: 'breed', type: 'String' }],
      name: 'Dog',
    },
    {
      extends: 'Pet',
      fields: [{ field: 'indoor', type: 'Boolean' }],
      name: 'Cat',
    },
  ],
}))

const ddl = seedEntities.ddl.map(statement => `${statement};`).join('\n')
const sql = `begin;

create schema if not exists basis_seed;
set local search_path to basis_seed;

${ddl}

insert into "Entity" ("id", "name", "entity")
select value::text,
  'pet-' || lpad(value::text, 6, '0'),
  case when value % 2 = 0 then 'Dog' else 'Cat' end
from generate_series(1, 500000) as series(value);

insert into "Pet" ("id", "nickname")
select value::text, 'pet-' || value
from generate_series(1, 500000) as series(value);

insert into "Dog" ("id", "breed")
select value::text, 'breed'
from generate_series(2, 500000, 2) as series(value);

insert into "Cat" ("id", "indoor")
select value::text, true
from generate_series(1, 499999, 2) as series(value);

analyze "Entity";
analyze "Pet";
analyze "Dog";
analyze "Cat";

commit;
`

writeFileSync(join(import.meta.dir, 'seed.sql'), sql)
