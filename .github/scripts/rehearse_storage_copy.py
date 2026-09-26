#!/usr/bin/env python3
"""Build the storage part of the rehearse copy from two production dumps.

`supabase db dump` leaves out the storage schema, which Supabase manages, so
the rehearse copy had neither production's buckets nor its access rules on
stored files, and the tests for patient documents could not run. This keeps
only those two things:

  - every CREATE POLICY on a storage table, from
    `supabase db dump --schema storage` (each preceded by a DROP POLICY IF
    EXISTS, so a rule the local stack already has is replaced, not doubled);
  - the rows of storage.buckets, from
    `supabase db dump --data-only --schema storage -x storage.objects ...`.
    They are loaded into a temporary table first and copied into
    storage.buckets for the columns both sides have, so a storage version on
    production newer or older than the local stack's still loads (ON CONFLICT
    DO NOTHING keeps a bucket the local stack already made).

Everything else in both files is dropped. The resulting SQL goes to stdout
and is loaded into the local stack; it never leaves the runner. Only counts
go to stderr, because this repository is public.

usage: rehearse_storage_copy.py STORAGE_SCHEMA_SQL STORAGE_DATA_SQL
"""
import re
import sys

POLICY = re.compile(
    r'CREATE POLICY ("(?:[^"]|"")+") ON ("storage"\."(?:[^"]|"")+")\s', re.S)
BUCKETS = 'INSERT INTO "storage"."buckets" '


def statements(sql):
    """Split pg_dump output into statements, ignoring ; inside quotes and comments."""
    out, start, i, n = [], 0, 0, len(sql)
    while i < n:
        c = sql[i]
        if c == "'" or c == '"':
            j = i + 1
            while j < n:
                if sql[j] == c:
                    if j + 1 < n and sql[j + 1] == c:  # '' or "" escape
                        j += 2
                        continue
                    break
                j += 1
            i = j + 1
        elif c == '-' and sql.startswith('--', i):
            j = sql.find('\n', i)
            i = n if j < 0 else j + 1
        elif c == '/' and sql.startswith('/*', i):
            j = sql.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif c == '$':
            m = re.match(r'\$([A-Za-z_][A-Za-z0-9_]*)?\$', sql[i:])
            if m:
                j = sql.find(m.group(0), i + len(m.group(0)))
                i = n if j < 0 else j + len(m.group(0))
            else:
                i += 1
        elif c == ';':
            out.append(sql[start:i])
            start = i = i + 1
        else:
            i += 1
    if sql[start:].strip():
        out.append(sql[start:])
    return out


def body(stmt):
    """The statement without the comment lines pg_dump puts in front of it."""
    lines = stmt.strip().splitlines()
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith('--')):
        lines.pop(0)
    return '\n'.join(lines).strip()


COPY_BUCKETS = """DO $$
DECLARE
  cols text;
  vals text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
         string_agg(format('%I::%s', a.attname, format_type(a.atttypid, a.atttypmod)),
                    ', ' ORDER BY a.attnum)
    INTO cols, vals
    FROM pg_attribute a
   WHERE a.attrelid = 'storage.buckets'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND a.attname IN (SELECT t.attname FROM pg_attribute t
                        WHERE t.attrelid = 'pg_temp.rehearse_buckets'::regclass
                          AND t.attnum > 0);
  EXECUTE format('INSERT INTO storage.buckets (%s) SELECT %s FROM pg_temp.rehearse_buckets '
                 'ON CONFLICT (id) DO NOTHING', cols, vals);
END $$;"""


def bucket_rows(stmt):
    """Production's bucket INSERT, aimed at an all-text temporary table."""
    rest = stmt[len(BUCKETS):]
    if not rest.startswith('('):
        sys.exit('rehearse_storage_copy: unexpected storage.buckets INSERT')
    close = rest.index(')')
    columns = rest[1:close]
    names = [c.strip() for c in columns.split(',')]
    if not names or not all(re.fullmatch(r'"(?:[^"]|"")+"', c) for c in names):
        sys.exit('rehearse_storage_copy: unexpected storage.buckets column list')
    table = ', '.join(f'{c} text' for c in names)
    return (f'CREATE TEMP TABLE rehearse_buckets ({table});\n'
            f'INSERT INTO pg_temp.rehearse_buckets ({columns}){rest[close + 1:]};')


def main(schema_path, data_path):
    with open(schema_path, encoding='utf-8') as f:
        schema = f.read()
    with open(data_path, encoding='utf-8') as f:
        data = f.read()

    policies, buckets = [], []
    for stmt in map(body, statements(schema)):
        m = POLICY.match(stmt)
        if m:
            policies.append(f'DROP POLICY IF EXISTS {m.group(1)} ON {m.group(2)};\n{stmt};')
    for stmt in map(body, statements(data)):
        if stmt.startswith(BUCKETS):
            buckets.append(bucket_rows(stmt))

    if len(buckets) > 1:
        sys.exit('rehearse_storage_copy: more than one storage.buckets INSERT')
    rows = sum(len(re.findall(r'^\s*\(', b, re.M)) for b in buckets)
    print('-- Generated by .github/scripts/rehearse_storage_copy.py')
    print("SET search_path = '';")
    print('\n'.join(buckets + ([COPY_BUCKETS] if buckets else []) + policies))
    print(f'storage copy: {len(policies)} access rules, {rows} buckets', file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip().splitlines()[-1])
    main(sys.argv[1], sys.argv[2])
