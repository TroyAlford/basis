begin;

create schema if not exists basis_seed;
set local search_path to basis_seed;

create extension if not exists pg_trgm with schema public;
create table "Entity" (
"id" text primary key,
"name" text not null,
"entity" text not null,
constraint "Entity_id_format_check" check (("id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or case
    when "id" ~ '^(0|-?[1-9][0-9]*)$' and length("id") <= 20
      then "id"::numeric between -9223372036854775808 and 9223372036854775807
    else false
  end)),
constraint "Entity_entity_check" check ("entity" in ('SystemUser', 'Client'))
);
create index if not exists "Entity_name_id_idx" on "Entity" ("name", "id");
create index if not exists "Entity_name_trgm_idx" on "Entity" using gin ("name" public.gin_trgm_ops);
create table "User" (
"id" text primary key,
"email" text not null,
constraint "User_id_format_check" check (case
    when "id" ~ '^(0|-?[1-9][0-9]*)$' and length("id") <= 20
      then "id"::numeric between -9223372036854775808 and 9223372036854775807
    else false
  end)
);
create table "SystemUser" (
"id" text primary key,
"permissions" text not null,
constraint "SystemUser_id_format_check" check (case
    when "id" ~ '^(0|-?[1-9][0-9]*)$' and length("id") <= 20
      then "id"::numeric between -9223372036854775808 and 9223372036854775807
    else false
  end)
);
create table "Client" (
"id" text primary key,
"company" text not null,
constraint "Client_id_format_check" check (case
    when "id" ~ '^(0|-?[1-9][0-9]*)$' and length("id") <= 20
      then "id"::numeric between -9223372036854775808 and 9223372036854775807
    else false
  end)
);
alter table "User" add constraint "User_Entity_mti_fkey" foreign key ("id") references "Entity" ("id") deferrable initially immediate;
alter table "SystemUser" add constraint "SystemUser_User_mti_fkey" foreign key ("id") references "User" ("id") deferrable initially immediate;
alter table "Client" add constraint "Client_User_mti_fkey" foreign key ("id") references "User" ("id") deferrable initially immediate;
create or replace function "Entity_validate_leaf"() returns trigger language plpgsql as $$
declare
  root_id text;
  root_entity text;
begin
  root_id := new."id";
  select "entity" into root_entity from "Entity" where "id" = root_id;
  if not found then
    return null;
  end if;
  case root_entity
    when 'SystemUser' then
        if not exists (select 1 from "SystemUser" where "id" = root_id) then
          raise exception 'incomplete root row % for entity %', root_id, root_entity;
        end if;
    when 'Client' then
        if not exists (select 1 from "Client" where "id" = root_id) then
          raise exception 'incomplete root row % for entity %', root_id, root_entity;
        end if;
    else
      raise exception 'unknown concrete entity %', root_entity;
  end case;
  return new;
end
$$;
create or replace function "Entity_validate_leaf_row"() returns trigger language plpgsql as $$
declare
  key text;
  root_entity text;
  leaf_present integer;
begin
  if tg_op = 'UPDATE'
    and to_jsonb(old)->>'id' is distinct from to_jsonb(new)->>'id' then
    raise exception 'leaf row identity is immutable';
  end if;
  if tg_op = 'DELETE' then
    key := to_jsonb(old)->>'id';
  else
    key := to_jsonb(new)->>'id';
  end if;
  execute format('select 1 from %I where "id" = $1', tg_table_name)
    into leaf_present using key;
  if leaf_present is not null then
    select "entity" into root_entity from "Entity" where "id" = key;
    if not found then
      raise exception 'leaf row % has no root row', key;
    end if;
    if root_entity is distinct from tg_table_name then
      raise exception 'leaf row % must match root entity %, found %',
        key, tg_table_name, root_entity;
    end if;
  elsif exists (
    select 1 from "Entity" where "id" = key and "entity" = tg_table_name
  ) then
    raise exception 'deleting leaf row % would leave an incomplete root row', key;
  end if;
  return null;
end
$$;
create or replace function "Entity_leaf_immutable"() returns trigger language plpgsql as $$
begin
  if new."entity" is distinct from old."entity" then
    raise exception 'leaf discriminator for root row % is immutable', old."id";
  end if;
  return new;
end
$$;
create constraint trigger "Entity_leaf_check" after insert or update on "Entity" deferrable initially deferred for each row execute function "Entity_validate_leaf"();
create constraint trigger "SystemUser_leaf_check" after insert or update or delete on "SystemUser" deferrable initially deferred for each row execute function "Entity_validate_leaf_row"();
create constraint trigger "Client_leaf_check" after insert or update or delete on "Client" deferrable initially deferred for each row execute function "Entity_validate_leaf_row"();
create trigger "Entity_leaf_immutable" before update of "entity" on "Entity" for each row execute function "Entity_leaf_immutable"();

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
