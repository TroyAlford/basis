import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EntityDefinitions } from '../../../libraries/server/source/EntityDefinitions'

/** The deterministic model used by the large PostgreSQL fixture. */
const seedEntities = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'Snowflake' },
        { field: 'email', type: 'String' },
      ],
      name: 'User',
    },
    {
      extends: 'User',
      fields: [{ field: 'permissions', type: 'String' }],
      name: 'SystemUser',
    },
    {
      extends: 'User',
      fields: [{ field: 'company', type: 'String' }],
      name: 'Client',
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
  'person-' || lpad(value::text, 6, '0'),
  case when value % 2 = 0 then 'SystemUser' else 'Client' end
from generate_series(1, 500000) as series(value);

insert into "User" ("id", "email")
select value::text, 'user-' || value || '@example.test'
from generate_series(1, 500000) as series(value);

insert into "SystemUser" ("id", "permissions")
select value::text, 'permissions'
from generate_series(2, 500000, 2) as series(value);

insert into "Client" ("id", "company")
select value::text, 'company'
from generate_series(1, 499999, 2) as series(value);

analyze "Entity";
analyze "User";
analyze "SystemUser";
analyze "Client";

commit;
`

writeFileSync(join(import.meta.dir, 'seed.sql'), sql)
