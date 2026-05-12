# scripts/

Operational scripts for the Claims Command Center frontend.

## `refresh-monday-schema.sh`

Pulls the latest column structure of the Claims Board (id `18245429780`) and
its Subitems board (id `18245429979`) from the Monday GraphQL API and writes
a formatted markdown reference to `../MONDAY_BOARD_SCHEMA.md` at the repo
root.

The output file is **gitignored** — it lives in your working copy as a local
reference. Re-run the script any time the Monday board structure changes
(new column, renamed status label, new group, etc.) and the file regenerates
with current data.

### Usage

```bash
# Token from https://medicallymodern-force.monday.com → avatar → Developers → My Access Tokens
export MONDAY_API_TOKEN="eyJhbGciOi..."

./scripts/refresh-monday-schema.sh
```

Or with a `.env` file at repo root (also gitignored):

```bash
# .env
MONDAY_API_TOKEN=eyJhbGciOi...
```

```bash
set -a; source .env; set +a
./scripts/refresh-monday-schema.sh
```

### What it captures

- Board metadata (name, workspace, item count, owners, last-updated)
- All groups (id, title, color, position, archived state)
- All columns (id, title, type, settings)
- For status / color columns: every label with its numeric id, name, and color
- For dropdown columns: every option with its id and name
- For formula columns: the formula expression
- For mirror columns: which column on which related board is being mirrored
- For the subtasks column: the linked subitem board id
- For numbers columns: unit symbol, function, decimal places

### When to re-run

- Anyone adds, removes, or renames a column on either board
- A status column gets a new label or a label is renamed
- A formula changes
- A new group is added
- The board's column types are changed (rare but possible)

If the backend integration ever fails on a column not being found, that's a
strong signal someone changed the board and the schema doc needs a refresh.
