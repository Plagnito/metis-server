# Back up and restore

A backup contains a consistent SQLite snapshot and `instance.key`. The key unlocks
the encrypted credentials in that snapshot. Keep the complete backup private and
protect the storage containing it.

## Node installation

From the project directory:

```sh
npm run backup -- ../metis-backup-2026-11-01
```

The target directory must not exist. The server can remain running: SQLite creates
a consistent snapshot. The script writes a manifest with the SHA-256 and length of
every included file. Documents, history, routines, logs and encrypted credentials
are included in the database.

To restore:

```sh
npm run restore -- ../metis-backup-2026-11-01 ../metis-restored-data
```

The target must be a **new directory**. The restore script rejects missing, extra,
modified or symbolic-link files, verifies the manifest and SQLite integrity, and
revokes old browser sessions, MCP keys and authorization codes. Jobs active at the
time of the backup become interrupted. No job is silently replayed.

Start the server with `METIS_DATA_DIR` set to the restored directory. The existing
administrator password is retained. Recreate MCP keys or authorize clients again.
Your original data directory is preserved.

## Docker installation

Create a backup inside the container, then copy it out:

```sh
docker compose exec metis node --no-warnings scripts/backup.cjs /tmp/metis-backup
docker compose cp metis:/tmp/metis-backup ./metis-backup
```

Use a fresh `/tmp` backup name on each run. The tmpfs is 32 MiB by default; for
larger databases, mount a dedicated writable backup directory or use a volume
snapshot with the container stopped. Do not increase tmpfs without considering
your machine's memory.

Restore the copied backup using Node into a new host directory, then run a separate
instance with that directory mounted at `/data`. Keep the original Docker volume
until the restored instance has been checked. File ownership must allow the
unprivileged container user (UID 1000) to read and write the restored directory.

Never copy only `metis.db` while the server is running: active WAL changes can be
missing from such a copy. Use the snapshot script or stop the server first.
