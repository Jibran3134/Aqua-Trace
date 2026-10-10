# Move PostgreSQL persistence to Supabase

This is a native PostgreSQL migration, not a rewrite around the Supabase SDK.
SQLAlchemy/Psycopg, Alembic, UUIDs, UTC timestamps, JSONB, foreign keys and checks
remain the persistence contract. No Supabase authentication tables or custom
extensions are required. Redis remains a separately configured service.

## Connection and schema rules

Use the exact connection values from Supabase's Connect dialog. A persistent API
can use a direct connection where its IP support is available, or the session
pooler for IPv4-only hosts. Use a direct/session connection for migrations and
dump/restore. Transaction pooling does not preserve session state; this backend
disables Psycopg prepared statements with `prepare_threshold=None`. Keep migration
and runtime URLs separate when runtime uses pooling or a restricted role.
[Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres).

Preserve both `aquatrace` and `aquatrace_private`. Do not add either application
schema to Supabase's exposed Data API schema list: the frontend accesses FastAPI.
Never expose `aquatrace_private`, grant it to anonymous browser roles, or copy
truth into an exposed table/view. The migration revokes PUBLIC access to its
private objects; verify privileges again after restore. Alembic autogeneration
filters introspection to application schemas/tables and must not modify Supabase
managed `auth`, `storage` or other system objects.

Use TLS for hosted connections. `sslmode=require` requires encryption;
`sslmode=verify-full` plus `sslrootcert` verifies the certificate and hostname too.
Download the correct certificate from the project settings and configure its
path on the runtime device/container. SQLAlchemy's Psycopg URL query parameters
carry these libpq options. Do not silently disable TLS to fix a connection issue.
[PostgreSQL TLS documentation](https://www.postgresql.org/docs/current/libpq-ssl.html).

## Migration procedure

1. Back up the source. Check source/target PostgreSQL versions, required privileges,
   schema/table inventory and `pg_extension`. Use compatible PostgreSQL client
   tools. Perform a rehearsal on a disposable target before the actual move.
2. Create the Supabase project. Set `MIGRATION_DATABASE_URL` in a private `.env`
   to its direct/session URL with TLS parameters. Keep `DATABASE_URL` pointing to
   the source until cutover. Run `python -m alembic upgrade head` against the fresh
   target to establish the exact current schema and migration revision.
3. Pause source application writes for a consistent snapshot. Export application
   data only, preserving both observation and truth schemas. With the default
   local Compose database/user names:

   ```text
   docker compose exec -T postgres pg_dump --username=aquatrace --dbname=aquatrace --data-only --schema=aquatrace --schema=aquatrace_private --no-owner --no-privileges --format=custom --file=/tmp/aquatrace-data.dump
   docker compose cp postgres:/tmp/aquatrace-data.dump ./aquatrace-data.dump
   ```

4. Configure a private libpq service named `aquatrace_target` with the target
   hostname, port, username, database, password and TLS options. A service name
   keeps credentials out of command text; use your local PostgreSQL service file
   or set `PGSERVICEFILE` to a private file. Restore with native client tools:

   ```text
   pg_restore --dbname=service=aquatrace_target --data-only --no-owner --no-privileges --single-transaction --exit-on-error aquatrace-data.dump
   ```

   The target must be empty of application records. Do not disable integrity
   constraints or continue after errors. Using data-only restore preserves the
   schema Alembic created and avoids restoring local owners/Supabase-managed roles.
5. Verify exact row counts in both application tables, expected UUID samples,
   expiry timestamps, observation/truth foreign-key integrity, the Alembic
   revision, private-schema privileges and a representative persisted
   leak/detect/reveal flow. Refresh database statistics after a large import.
6. Change `DATABASE_URL` to the verified target runtime connection and redeploy
   the API. The supplied Compose file is a local stack and explicitly overrides
   URLs to its local PostgreSQL service; a hosted deployment must use an override
   with the target URLs or run the application image with the hosted environment.
   Keep `MIGRATION_DATABASE_URL` on the target's direct/session path.
   Scenario IDs/state survive because their rows were copied. Redis public cache
   values can be regenerated; restart cached state or use a new `CACHE_KEY_VERSION`
   when deliberately switching computation/persistence environments.

Do not run the opt-in integration suite against a live production database.
Use a disposable project/database for the migration rehearsal and tests. Preserve
the source snapshot until application validation is complete; if cutover fails,
restore the previous application URL before accepting new writes. A rollback
after accepting target writes requires reconciling those writes, not simply
switching hosts.

See [Supabase's PostgreSQL migration guide](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres)
and [libpq service-file configuration](https://www.postgresql.org/docs/current/libpq-pgservice.html).
This runbook is a migration design; an actual hosted Supabase migration is not
claimed until it has been performed and its results recorded in `validation.md`.
