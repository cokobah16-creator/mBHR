#!/usr/bin/env python3
"""Summarise production's migration history without printing any SQL.

Reads a data-only dump of supabase_migrations.schema_migrations and prints, for
each version (or only the versions listed in a file), its name and the database
objects its SQL creates, alters or drops. Workflow logs of a public repository
are public, so the SQL itself (which may hold keys, e.g. in cron jobs) is never
printed.

Usage: migration_history.py DUMP.sql [VERSIONS.txt]
"""
import re
import sys

OBJECT_RE = re.compile(
    r"\b(create|alter|drop)\s+(?:or\s+replace\s+)?(?:unique\s+)?"
    r"(table|function|policy|index|trigger|view|type|schema|extension|sequence)\s+"
    r"(?:if\s+(?:not\s+)?exists\s+)?(?:concurrently\s+)?"
    r"(\"[^\"]+\"(?:\.\"[^\"]+\")?|[\w.]+)",
    re.IGNORECASE,
)


def sql_values(text, i):
    """Parse a parenthesised VALUES tuple starting at text[i] == '('."""
    assert text[i] == "("
    i += 1
    values, cur, in_str = [], [], False
    while i < len(text):
        c = text[i]
        if in_str:
            if c == "'":
                if i + 1 < len(text) and text[i + 1] == "'":
                    cur.append("'")
                    i += 1
                else:
                    in_str = False
            else:
                cur.append(c)
        elif c == "'":
            in_str = True
        elif c == ",":
            values.append("".join(cur).strip())
            cur = []
        elif c == ")":
            values.append("".join(cur).strip())
            return values, i + 1
        else:
            cur.append(c)
        i += 1
    raise ValueError("unterminated VALUES tuple")


def rows_from_inserts(text):
    pat = re.compile(
        r'INSERT INTO "?supabase_migrations"?\."?schema_migrations"?\s*\(([^)]*)\)\s*VALUES\s*',
        re.IGNORECASE,
    )
    for m in pat.finditer(text):
        cols = [c.strip().strip('"') for c in m.group(1).split(",")]
        i = m.end()
        while i < len(text) and text[i] == "(":
            vals, i = sql_values(text, i)
            yield dict(zip(cols, vals))
            while i < len(text) and text[i] in " \t\r\n,":
                i += 1


def rows_from_copy(text):
    m = re.search(
        r'COPY "?supabase_migrations"?\."?schema_migrations"?\s*\(([^)]*)\)\s*FROM stdin;\n(.*?)\n\\\.',
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return
    cols = [c.strip().strip('"') for c in m.group(1).split(",")]
    for line in m.group(2).split("\n"):
        vals = [v.replace("\\n", "\n").replace("\\t", "\t") for v in line.split("\t")]
        yield dict(zip(cols, vals))


def main():
    text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
    wanted = None
    if len(sys.argv) > 2:
        wanted = {l.strip() for l in open(sys.argv[2]) if l.strip()}
    rows = list(rows_from_inserts(text)) or list(rows_from_copy(text))
    if not rows:
        print("No rows for supabase_migrations.schema_migrations found in the dump.")
        return
    for row in sorted(rows, key=lambda r: r.get("version", "")):
        version = row.get("version", "?")
        if wanted is not None and version not in wanted:
            continue
        stmts = (row.get("statements") or "").replace('\\"', '"').replace("\\n", "\n")
        objects = sorted({f"{a.lower()} {k.lower()} {n}" for a, k, n in OBJECT_RE.findall(stmts)})
        print(f"{version}  {row.get('name') or '(no name)'}")
        for o in objects[:40]:
            print(f"    {o}")
        if len(objects) > 40:
            print(f"    ... and {len(objects) - 40} more")


if __name__ == "__main__":
    main()
