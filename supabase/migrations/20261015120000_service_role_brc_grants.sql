grant usage on schema brc to service_role;

grant select, insert, update, delete
on all tables in schema brc
to service_role;

grant usage, select, update
on all sequences in schema brc
to service_role;

alter default privileges in schema brc
grant select, insert, update, delete on tables to service_role;

alter default privileges in schema brc
grant usage, select, update on sequences to service_role;
