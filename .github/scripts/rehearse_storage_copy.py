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
    `supabase db dump --data-only --schema storage -x ...`, where the -x list
    names every storage table except buckets (see --exclude-args). They are
    loaded into a temporary table first and copied into storage.buckets for
    the columns both sides have, so a storage version on production newer or
    older than the local stack's still loads (ON CONFLICT DO NOTHING keeps a
    bucket the local stack already made).

Everything else in both files is dropped. The resulting SQL goes to stdout
and is loaded into the local stack; it never leaves the runner. Only counts
go to stderr, because this repository is public.

usage: rehearse_storage_copy.py STORAGE_SCHEMA_SQL STORAGE_DATA_SQL
       rehearse_storage_copy.py --exclude-args STORAGE_SCHEMA_SQL
"""
import re
import sys

POLICY = re.compile(
    r'CREATE POLICY ("(?:[^"]|"")+") ON ("storage"\."(?:[^"]|"")+")(?=\s|$)', re.S)
TABLE = re.compile(
    r'^CREATE (?:UNLOGGED )?TABLE (?:IF NOT EXISTS )?"storage"\."((?:[^"]|"")+)"', re.M)
BUCKETS = 'INSERT INTO "storage"."buckets" '
LEADING_COMMENTS = re.compile(r'\A(?:[ \t\r]*(?:--[^\n]*)?\n)+')
DOLLAR = re.compile(r'\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$')


def fail(message):
    sys.exit(f'rehearse_storage_copy: {message}')


def read(path):
    # newline='' keeps a CR inside a quoted value as it is.
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def scan(sql, on_char):
    """Walk sql outside quotes, dollar quotes and comments, calling on_char(i, c)."""
    i, n = 0, len(sql)
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
        elif c == '$' and DOLLAR.match(sql, i):
            tag = DOLLAR.match(sql, i).group(0)
            j = sql.find(tag, i + len(tag))
            i = n if j < 0 else j + len(tag)
        else:
            on_char(i, c)
            i += 1


def statements(sql):
    """Split pg_dump output into statements, ignoring ; inside quotes and comments."""
    ends = []
    scan(sql, lambda i, c: ends.append(i) if c == ';' else None)
    out, start = [], 0
    for end in ends:
        out.append(sql[start:end])
        start = end + 1
    if sql[start:].strip():
        out.append(sql[start:])
    return out


def body(stmt):
    """The statement without the blank and comment lines pg_dump puts in front of it."""
    return LEADING_COMMENTS.sub('', stmt).strip()


def top_level_groups(values):
    """Number of parenthesised rows in an INSERT's VALUES list."""
    depth, rows = [0], [0]

    def on_char(_, c):
        if c == '(':
            if depth[0] == 0:
                rows[0] += 1
            depth[0] += 1
        elif c == ')':
            depth[0] -= 1

    scan(values, on_char)
    return rows[0]


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
    """Production's bucket INSERT, aimed at an all-text temporary table; and its row count."""
    rest = stmt[len(BUCKETS):]
    if not rest.startswith('('):
        fail('unexpected storage.buckets INSERT')
    close = rest.index(')')
    columns = rest[1:close]
    names = [c.strip() for c in columns.split(',')]
    if not names or not all(re.fullmatch(r'"(?:[^"]|"")+"', c) for c in names):
        fail('unexpected storage.buckets column list')
    values = rest[close + 1:].lstrip()
    if not values.startswith('VALUES'):
        fail('unexpected storage.buckets INSERT')
    table = ', '.join(f'{c} text' for c in names)
    sql = (f'CREATE TEMP TABLE rehearse_buckets ({table});\n'
           f'INSERT INTO pg_temp.rehearse_buckets ({columns}) {values};')
    return sql, top_level_groups(values[len('VALUES'):])


def exclude_args(schema_path):
    """-x flags for every storage table except buckets, so the data dump reads only buckets."""
    tables = [m.group(1).replace('""', '"') for m in TABLE.finditer(read(schema_path))]
    if 'buckets' not in tables:
        fail('storage.buckets is not in the storage schema dump')
    others = sorted(set(tables) - {'buckets'})
    if not all(re.fullmatch(r'[a-z_][a-z0-9_]*', t) for t in others):
        fail('a storage table has a name this script cannot pass to -x safely')
    print(' '.join(f'-x storage.{t}' for t in others))


def main(schema_path, data_path):
    policies = []
    for stmt in map(body, statements(read(schema_path))):
        m = POLICY.match(stmt)
        if m:
            policies.append(f'DROP POLICY IF EXISTS {m.group(1)} ON {m.group(2)};\n{stmt};')

    buckets, rows = [], 0
    for stmt in map(body, statements(read(data_path))):
        if stmt.startswith(BUCKETS):
            sql, count = bucket_rows(stmt)
            buckets.append(sql)
            rows += count
        elif stmt.startswith('INSERT INTO '):
            # The -x list should leave only buckets; stop rather than guess.
            fail('the storage data dump has rows from a table other than storage.buckets')
    if len(buckets) > 1:
        fail('more than one storage.buckets INSERT')

    print('-- Generated by .github/scripts/rehearse_storage_copy.py')
    print("SET search_path = '';")
    print('SET client_min_messages = warning;')
    print('\n'.join(buckets + ([COPY_BUCKETS] if buckets else []) + policies))
    print(f'storage copy: {len(policies)} access rules, {rows} buckets', file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--exclude-args':
        exclude_args(sys.argv[2])
    elif len(sys.argv) == 3:
        main(sys.argv[1], sys.argv[2])
    else:
        sys.exit('usage: ' + __doc__.split('usage: ', 1)[1].strip())
