#!/usr/bin/env python3
"""
Format the Monday raw board schema response into a human-readable markdown doc.

Usage:
  refresh-monday-schema.sh fetches the raw response into a temp file, then
  invokes this script which writes the formatted output to stdout.

The script reads JSON on stdin and writes Markdown on stdout.
"""
import json
import sys
from datetime import datetime, timezone


CLAIMS_BOARD_ID = "18245429780"
SUBITEMS_BOARD_ID = "18245429979"
SECONDARY_BOARD_ID = "18413019028"
SECONDARY_SUBITEMS_BOARD_ID = "18413019033"


def parse_settings(settings_str):
    """Decode settings_str into a dict; return None if empty or unparseable."""
    if not settings_str or settings_str == "{}":
        return None
    try:
        return json.loads(settings_str)
    except Exception:
        return {"_raw": settings_str}


def render_column(col):
    out = []
    out.append(f"#### `{col['id']}` — {col['title']}")
    out.append(f"- **Type:** `{col['type']}`")
    if col.get("description"):
        out.append(f"- **Description:** {col['description']}")
    if col.get("archived"):
        out.append("- **Archived:** yes")

    settings = parse_settings(col["settings_str"])
    if settings:
        if col["type"] in ("status", "color"):
            labels = settings.get("labels") or {}
            colors = settings.get("labels_colors") or {}
            if labels:
                out.append("- **Labels:**")
                # Sort by numeric index where possible
                def sort_key(k):
                    try:
                        return (0, int(k))
                    except (TypeError, ValueError):
                        return (1, str(k))

                for idx in sorted(labels.keys(), key=sort_key):
                    label = labels[idx]
                    color_info = colors.get(idx, {})
                    color = (
                        color_info.get("color")
                        if isinstance(color_info, dict)
                        else color_info
                    )
                    suffix = f" *(color: {color})*" if color else ""
                    out.append(f'  - `{idx}` → "{label}"{suffix}')
        elif col["type"] == "dropdown":
            labels = settings.get("labels") or []
            if labels:
                out.append("- **Options:**")
                for item in labels:
                    if isinstance(item, dict):
                        out.append(f'  - `{item.get("id")}` → "{item.get("name")}"')
                    else:
                        out.append(f'  - "{item}"')
        elif col["type"] == "numbers":
            unit = (
                settings.get("unit", {}).get("symbol")
                if isinstance(settings.get("unit"), dict)
                else None
            )
            if unit:
                out.append(f"- **Unit:** `{unit}`")
            if settings.get("function"):
                out.append(f"- **Function:** `{settings['function']}`")
            if settings.get("decimal_places") is not None:
                out.append(f"- **Decimal places:** {settings['decimal_places']}")
        elif col["type"] == "formula":
            if settings.get("formula"):
                out.append(f"- **Formula:** `{settings['formula']}`")
        elif col["type"] == "mirror":
            if settings.get("relation_column"):
                out.append(f"- **Relation column:** `{settings['relation_column']}`")
            if settings.get("mirrored_column_id"):
                out.append(f"- **Mirrored column:** `{settings['mirrored_column_id']}`")
            if settings.get("display_field"):
                out.append(f"- **Display field:** `{settings['display_field']}`")
        elif col["type"] == "subtasks":
            board_ids = settings.get("boardIds") or []
            if board_ids:
                out.append(
                    f"- **Subitems board(s):** {', '.join(str(b) for b in board_ids)}"
                )
        elif col["type"] == "date":
            tz = settings.get("time_zone")
            if tz:
                out.append(f"- **Timezone:** {tz}")
    return "\n".join(out)


def render_board(b, heading_level=2):
    h = "#" * heading_level
    out = [f"{h} {b['name']}", ""]
    out.append(f"- **ID:** `{b['id']}`")
    out.append(
        f"- **Workspace:** {b['workspace']['name']} (id `{b['workspace']['id']}`)"
    )
    out.append(f"- **State:** {b['state']}")
    out.append(f"- **Board kind:** {b['board_kind']}")
    out.append(f"- **Item count:** {b['items_count']}")
    if b.get("owners"):
        owners = ", ".join(o["name"] for o in b["owners"])
        out.append(f"- **Owners:** {owners}")
    if b.get("updated_at"):
        out.append(f"- **Board last updated:** {b['updated_at']}")
    if b.get("description"):
        out.append(f"- **Description:** {b['description']}")
    out.append("")

    # Groups
    if b.get("groups"):
        active = [g for g in b["groups"] if not g.get("archived")]
        out.append(f"{h}# Groups ({len(active)})")
        out.append("")
        out.append("| Position | ID | Title | Color | Archived |")
        out.append("|----------|----|----|----|----|")
        for g in sorted(b["groups"], key=lambda x: x.get("position") or ""):
            out.append(
                f"| {g.get('position','')} | `{g['id']}` | {g['title']} | "
                f"{g.get('color','')} | {'yes' if g.get('archived') else ''} |"
            )
        out.append("")

    # Columns
    cols = b.get("columns", [])
    out.append(f"{h}# Columns ({len(cols)})")
    out.append("")
    out.append("Quick reference table (full details below):")
    out.append("")
    out.append("| ID | Title | Type | Notes |")
    out.append("|----|----|----|----|")
    for c in cols:
        notes = []
        if c.get("archived"):
            notes.append("archived")
        if c["type"] == "status":
            settings = parse_settings(c["settings_str"])
            if settings and settings.get("labels"):
                notes.append(f"{len(settings['labels'])} labels")
        if c["type"] == "subtasks":
            settings = parse_settings(c["settings_str"])
            if settings and settings.get("boardIds"):
                notes.append(f"→ board {settings['boardIds'][0]}")
        out.append(
            f"| `{c['id']}` | {c['title']} | `{c['type']}` | "
            f"{' / '.join(notes)} |"
        )
    out.append("")
    out.append(f"{h}# Column details")
    out.append("")
    for c in cols:
        out.append(render_column(c))
        out.append("")
    return "\n".join(out)


def main():
    raw = json.load(sys.stdin)
    if raw.get("errors"):
        print("Monday API returned errors:", file=sys.stderr)
        print(json.dumps(raw["errors"], indent=2), file=sys.stderr)
        sys.exit(1)

    boards = raw["data"]["boards"]
    parent = next((b for b in boards if b["id"] == CLAIMS_BOARD_ID), None)
    subitems = next((b for b in boards if b["id"] == SUBITEMS_BOARD_ID), None)
    secondary = next((b for b in boards if b["id"] == SECONDARY_BOARD_ID), None)
    sec_subitems = next(
        (b for b in boards if b["id"] == SECONDARY_SUBITEMS_BOARD_ID), None
    )
    if parent is None:
        print(f"Claims Board (id {CLAIMS_BOARD_ID}) not in response", file=sys.stderr)
        sys.exit(1)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    print("# Claims & Secondary Claims — Monday.com schema")
    print()
    print("> **Auto-generated reference for the Claims Command Center backend integration.**")
    print(f"> Fetched: {now}")
    print("> Source: Monday.com API v2 (query in `scripts/refresh-monday-schema.sh`)")
    print(">")
    print("> This file is the source of truth for what columns exist on the Claims and")
    print("> Secondary Claims boards (parent + subitems), what type each column is, and")
    print("> the exact label IDs + names for status/dropdown columns. When the board")
    print("> structure changes, re-run `scripts/refresh-monday-schema.sh` to regenerate")
    print("> this file. Do not edit by hand — your edits will be overwritten on next refresh.")
    print()
    print("## Board URLs")
    print()
    print(f"- Claims Board: https://medicallymodern-force.monday.com/boards/{CLAIMS_BOARD_ID}")
    if subitems:
        print(f"- Subitems of Claims Board: https://medicallymodern-force.monday.com/boards/{SUBITEMS_BOARD_ID}")
    if secondary:
        print(f"- Secondary Claims Board: https://medicallymodern-force.monday.com/boards/{SECONDARY_BOARD_ID}")
    if sec_subitems:
        print(f"- Subitems of Secondary Claims Board: https://medicallymodern-force.monday.com/boards/{SECONDARY_SUBITEMS_BOARD_ID}")
    print()
    print("## Summary")
    print()
    print("| Board | ID | Items | Columns | Groups |")
    print("|----|----|----|----|----|")
    print(
        f"| Claims Board | `{parent['id']}` | {parent['items_count']} | "
        f"{len(parent['columns'])} | {len(parent['groups'])} |"
    )
    if subitems:
        print(
            f"| Subitems of Claims Board | `{subitems['id']}` | "
            f"{subitems['items_count']} | {len(subitems['columns'])} | "
            f"{len(subitems['groups'])} |"
        )
    if secondary:
        print(
            f"| Secondary Claims Board | `{secondary['id']}` | "
            f"{secondary['items_count']} | {len(secondary['columns'])} | "
            f"{len(secondary['groups'])} |"
        )
    if sec_subitems:
        print(
            f"| Subitems of Secondary Claims Board | `{sec_subitems['id']}` | "
            f"{sec_subitems['items_count']} | {len(sec_subitems['columns'])} | "
            f"{len(sec_subitems['groups'])} |"
        )
    print()
    print("---")
    print()
    print(render_board(parent, heading_level=2))
    print()
    if subitems:
        print("---")
        print()
        print(render_board(subitems, heading_level=2))
        print()
    if secondary:
        print("---")
        print()
        print(render_board(secondary, heading_level=2))
        print()
    if sec_subitems:
        print("---")
        print()
        print(render_board(sec_subitems, heading_level=2))


if __name__ == "__main__":
    main()
