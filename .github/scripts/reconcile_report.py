#!/usr/bin/env python3
"""Compare production's database with the repo's migrations, without printing SQL.

Inputs (all produced inside the workflow job, none uploaded):
  --history   data-only dump of supabase_migrations.schema_migrations
  --schema    schema-only dump of production (supabase db dump --linked)
  --pending   file listing repo versions production has not applied
  --remote    file listing production versions with no repo file

Prints three sections:
  1. Each production-only migration next to the repo file with the same name,
     with how similar their SQL is (a ratio, never the SQL).
  2. For each pending repo migration, which of the tables, columns, functions,
     policies, indexes, triggers and types it creates already exist in
     production (names only).
  3. Production access rules open to anon/public, or with USING (true).

This repository is public, so its workflow logs are public: only object names
and numbers are printed.
"""
import argparse
import difflib
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migration_history import rows_from_copy, rows_from_inserts  # noqa: E402

MIGRATIONS_DIR = "supabase/migrations"


def ident(s):
    """Normalise an identifier: drop quotes and a leading public. schema."""
    s = s.strip().strip('"')
    s = re.sub(r'"', "", s)
    if s.lower().startswith("public."):
        s = s[7:]
    return s.lower()


def strip_comments(sql):
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", " ", sql)


def normalise(sql):
    return re.sub(r"\s+", " ", strip_comments(sql)).strip().lower()


def parse_pg_array(text):
    """Parse a Postgres text[] literal like {"a","b"} into a list of strings."""
    text = text.strip()
    if not (text.startswith("{") and text.endswith("}")):
        return [text]
    out, cur, i, quoted, in_q = [], [], 1, False, False
    body = text
    while i < len(body) - 1:
        c = body[i]
        if in_q:
            if c == "\\" and i + 1 < len(body) - 1:
                cur.append(body[i + 1])
                i += 1
            elif c == '"':
                in_q = False
            else:
                cur.append(c)
        elif c == '"':
            in_q, quoted = True, True
        elif c == ",":
            out.append("".join(cur))
            cur, quoted = [], False
        else:
            cur.append(c)
        i += 1
    out.append("".join(cur))
    return out


def history_rows(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    rows = list(rows_from_inserts(text)) or list(rows_from_copy(text))
    for r in rows:
        r["sql"] = ";\n".join(parse_pg_array(r.get("statements") or ""))
    return rows


# ---- objects a migration creates -------------------------------------------

NAME = r'((?:"[^"]+"|[\w]+)(?:\.(?:"[^"]+"|[\w]+))?)'
CREATE_PATTERNS = [
    ("table", re.compile(r"\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?" + NAME, re.I)),
    ("function", re.compile(r"\bcreate\s+(?:or\s+replace\s+)?function\s+" + NAME, re.I)),
    ("index", re.compile(r"\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?" + NAME, re.I)),
    ("trigger", re.compile(r"\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+" + NAME, re.I)),
    ("type", re.compile(r"\bcreate\s+type\s+" + NAME, re.I)),
    ("view", re.compile(r"\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?" + NAME, re.I)),
]
POLICY_RE = re.compile(r'\bcreate\s+policy\s+("[^"]+"|\w+)\s+on\s+' + NAME, re.I)
RLS_POLICY_CALL_RE = re.compile(r"app_rls_policy\(\s*'(\w+)'\s*,\s*'([^']+)'", re.I)
ADD_COLUMN_RE = re.compile(
    r"\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?" + NAME + r"((?:\s*(?:,\s*)?add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(?:\"[^\"]+\"|\w+)[^,;]*)+)",
    re.I,
)
ADD_COLUMN_ITEM_RE = re.compile(r"\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(\"[^\"]+\"|\w+)", re.I)
NOT_COLUMNS = {"constraint", "primary", "foreign", "unique", "check", "exclude"}


def created_objects(sql):
    sql = strip_comments(sql)
    objs = set()
    for kind, pat in CREATE_PATTERNS:
        for m in pat.finditer(sql):
            objs.add((kind, ident(m.group(1))))
    for m in POLICY_RE.finditer(sql):
        objs.add(("policy", f"{ident(m.group(2))}:{m.group(1).strip(chr(34)).lower()}"))
    for m in RLS_POLICY_CALL_RE.finditer(sql):
        objs.add(("policy", f"{m.group(1).lower()}:{m.group(2).lower()}"))
    for m in ADD_COLUMN_RE.finditer(sql):
        table = ident(m.group(1))
        for c in ADD_COLUMN_ITEM_RE.finditer(m.group(2)):
            col = ident(c.group(1))
            if col not in NOT_COLUMNS:
                objs.add(("column", f"{table}.{col}"))
    return objs


# ---- objects production has --------------------------------------------------

def production_objects(schema_sql):
    objs = set()
    for kind, pat in CREATE_PATTERNS:
        for m in pat.finditer(schema_sql):
            objs.add((kind, ident(m.group(1))))
    for m in POLICY_RE.finditer(schema_sql):
        objs.add(("policy", f"{ident(m.group(2))}:{m.group(1).strip(chr(34)).lower()}"))
    # Columns from CREATE TABLE bodies and ALTER TABLE ... ADD COLUMN.
    for m in re.finditer(r'CREATE TABLE (?:IF NOT EXISTS )?' + NAME + r'\s*\((.*?)\n\);', schema_sql, re.S | re.I):
        table = ident(m.group(1))
        objs.add(("table", table))
        for line in m.group(2).split("\n"):
            c = re.match(r'\s*("[^"]+"|\w+)\s', line)
            if c and ident(c.group(1)) not in NOT_COLUMNS:
                objs.add(("column", f"{table}.{ident(c.group(1))}"))
    for kind, name in created_objects(schema_sql):
        if kind == "column":
            objs.add((kind, name))
    return objs


def open_policies(schema_sql):
    out = []
    pat = re.compile(
        r'CREATE POLICY ("[^"]+"|\w+) ON ' + NAME + r'(.*?);\n', re.S | re.I)
    for m in pat.finditer(schema_sql):
        body = m.group(3)
        roles = re.search(r"\bTO\s+(.*?)(?:\s+USING|\s+WITH CHECK|$)", body, re.S | re.I)
        roles = roles.group(1).replace('"', "").strip() if roles else "public"
        cmd = re.search(r"\bFOR\s+(\w+)", body, re.I)
        cmd = cmd.group(1).upper() if cmd else "ALL"
        using_true = bool(re.search(r"USING\s*\(\s*true\s*\)", body, re.I))
        check_true = bool(re.search(r"WITH CHECK\s*\(\s*true\s*\)", body, re.I))
        role_set = {r.strip().lower() for r in roles.split(",")}
        if role_set == {"service_role"}:
            continue
        if role_set & {"anon", "public"} or using_true or check_true:
            flags = []
            if using_true:
                flags.append("USING (true)")
            if check_true:
                flags.append("WITH CHECK (true)")
            out.append(f"{ident(m.group(2))}  {m.group(1).strip(chr(34))}  {cmd} TO {roles}  {' '.join(flags)}".rstrip())
    return sorted(out)


def jaccard(a, b):
    return len(a & b) / len(a | b) if a | b else 0.0


def repo_files():
    files = {}
    for f in sorted(os.listdir(MIGRATIONS_DIR)):
        if f.endswith(".sql") and "_" in f:
            files[f.split("_", 1)[0]] = f
    return files


def name_of(f):
    return f.split("_", 1)[1][:-4]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--history", required=True)
    ap.add_argument("--schema", required=True)
    ap.add_argument("--pending", required=True)
    ap.add_argument("--remote", required=True)
    a = ap.parse_args()

    files = repo_files()
    rows = {r.get("version"): r for r in history_rows(a.history)}
    schema_sql = open(a.schema, encoding="utf-8", errors="replace").read()
    prod = production_objects(schema_sql)
    pending = [l.strip() for l in open(a.pending) if l.strip()]
    remote = [l.strip() for l in open(a.remote) if l.strip()]

    print("== 1. Production-only migrations vs repo files with the same name ==")
    by_name = {}
    for v, f in files.items():
        by_name.setdefault(name_of(f).lower(), []).append(f)
    for v in remote:
        row = rows.get(v)
        if not row:
            print(f"{v}  (not in history dump)")
            continue
        name = (row.get("name") or "").lower()
        candidates = by_name.get(name, [])
        prod_sql = normalise(row["sql"])
        if not candidates:
            # Fall back to the most similar repo file.
            prod_tokens = set(prod_sql.split())
            scored = sorted(
                ((jaccard(prod_tokens, set(normalise(open(os.path.join(MIGRATIONS_DIR, f)).read()).split())), f) for f in files.values()),
                reverse=True,
            )[:3]
            print(f"{v}  {row.get('name')}: no repo file with this name; most similar: " + ", ".join(f"{f} ({r:.2f})" for r, f in scored))
            continue
        for f in candidates:
            repo_sql = normalise(open(os.path.join(MIGRATIONS_DIR, f)).read())
            same = prod_sql.replace(";", "") == repo_sql.replace(";", "")
            ratio = difflib.SequenceMatcher(None, prod_sql.split(), repo_sql.split(), autojunk=False).ratio()
            p_objs, r_objs = created_objects(row["sql"]), created_objects(open(os.path.join(MIGRATIONS_DIR, f)).read())
            print(f"{v}  {row.get('name')} -> {f}: {'IDENTICAL' if same else 'differs'}, similarity {ratio:.3f}, "
                  f"objects prod-only {len(p_objs - r_objs)}, repo-only {len(r_objs - p_objs)}")
            for k, n in sorted(p_objs - r_objs)[:15]:
                print(f"    only in production's version: {k} {n}")
            for k, n in sorted(r_objs - p_objs)[:15]:
                print(f"    only in the repo file: {k} {n}")

    print()
    print("== 2. Pending repo migrations: do their objects already exist in production? ==")
    for v in pending:
        f = files.get(v)
        if not f:
            continue
        objs = created_objects(open(os.path.join(MIGRATIONS_DIR, f)).read())
        present = objs & prod
        absent = sorted(objs - prod)
        verdict = "none created" if not objs else ("ALL PRESENT" if not absent else ("NONE PRESENT" if not present else "PARTIAL"))
        print(f"{f}: {verdict}  ({len(present)}/{len(objs)} present)")
        for k, n in absent[:40]:
            print(f"    missing in production: {k} {n}")
        if len(absent) > 40:
            print(f"    ... and {len(absent) - 40} more missing")

    print()
    print("== 3. Production access rules open to anon/public or USING/WITH CHECK (true) ==")
    for line in open_policies(schema_sql):
        print(f"    {line}")

    print()
    kinds = {}
    for k, _ in prod:
        kinds[k] = kinds.get(k, 0) + 1
    print("Production object counts: " + ", ".join(f"{k} {n}" for k, n in sorted(kinds.items())))


if __name__ == "__main__":
    main()
