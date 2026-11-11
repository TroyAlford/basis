FROM postgres:17-alpine AS seed

ENV PGDATA=/seed
COPY seed.sql /seed.sql

RUN set -eux; \
    mkdir -p "$PGDATA"; \
    chown postgres:postgres "$PGDATA"; \
    gosu postgres initdb --auth=trust --username=basis --pgdata="$PGDATA" --no-locale; \
    printf '\nhost all all all trust\n' >> "$PGDATA/pg_hba.conf"; \
    gosu postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses='' -c unix_socket_directories=/tmp" -w start; \
    gosu postgres createdb -h /tmp -U basis basis; \
    gosu postgres psql -v ON_ERROR_STOP=1 -h /tmp -U basis -d basis -f /seed.sql; \
    gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop

FROM postgres:17-alpine
COPY --from=seed --chown=postgres:postgres /seed /var/lib/postgresql/data
