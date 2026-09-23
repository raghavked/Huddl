#!/usr/bin/env python3
"""Emit one SQL query that checks the mobile app's PostgREST usage against the
live schema: every from() table and selected/filtered column, every embed
(bare embeds must have exactly one foreign-key path; named ones must name a
real key between those tables), every rpc() name and argument, and every
storage bucket. Run the printed SQL against production (the MCP execute_sql
tool or psql); an empty result is a pass.

    python3 scripts/schema-check.py > /tmp/schema-check.sql

The extractor is regex-based and reads up to 900 characters past each from()
for its select, so a query with no select of its own can borrow the next
one's columns and produce a false "missing column"; check those by hand.
"""
import json, re, pathlib, sys
from collections import defaultdict
root = pathlib.Path(__file__).resolve().parent.parent / "src"
q = {"from": {}, "rpc": {}, "buckets": set(), "selects": [], "filters": []}
for p in root.rglob("*"):
    if p.suffix not in (".ts", ".tsx"): continue
    s = p.read_text()
    consts = {k: "".join(a or b for a, b in re.findall(r'"([^"]*)"|`([^`]*)`', v))
              for k, v in re.findall(r'const\s+([A-Z_]+SELECT)\s*=\s*((?:"[^"]*"|`[^`]*`|\s|\+)+);', s)}
    for m in re.finditer(r'\.from\("([a-z_]+)"\)', s):
        t = m.group(1); chain = s[m.end(): m.end() + 900]
        sm = re.search(r'\.select\(\s*(?:"([^"]*)"|`([^`]*)`|([A-Z_]+SELECT))', chain)
        if sm:
            sel = sm.group(1) or sm.group(2) or consts.get(sm.group(3), "")
            if sel: q["selects"].append({"table": t, "select": sel})
        for fm in re.finditer(r'\.(eq|neq|gt|gte|lt|lte|in|is|like|ilike|order|not)\("([a-z_.]+)"', chain.split(".from(")[0]):
            q["filters"].append({"table": t, "col": fm.group(2)})
    for m in re.finditer(r'\.rpc\("([a-z_]+)"(?:\s*,\s*\{([^}]*)\})?', s):
        q["rpc"].setdefault(m.group(1), set()).update(re.findall(r'([a-z_]+)\s*:', m.group(2) or ""))
    for m in re.finditer(r'storage\s*\.from\("([a-z_-]+)"\)', s):
        q["buckets"].add(m.group(1))
cols, embeds = defaultdict(set), set()
def split_top(s):
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(": depth += 1
        elif ch == ")": depth -= 1
        if ch == "," and depth == 0: out.append(cur); cur = ""
        else: cur += ch
    out.append(cur); return [t.strip() for t in out if t.strip()]
def parse(table, sel):
    for tok in split_top(sel):
        if "(" in tok:
            head, inner = tok[:tok.index("(")], tok[tok.index("(")+1:tok.rindex(")")]
            head = head.split(":")[-1].replace("...", "")
            child, con = (head.split("!") + [None])[:2]
            if con == "inner": con = None
            embeds.add((table, child, con))
            if inner.strip() != "count": parse(child, inner)
        else:
            col = tok.split(":")[-1].split("::")[0].strip()
            if col in ("*", "count") or "." in col or not re.fullmatch(r"[a-z_0-9]+", col): continue
            cols[table].add(col)
for s in q["selects"]: parse(s["table"], s["select"])
for f in q["filters"]:
    if "." not in f["col"]: cols[f["table"]].add(f["col"])
def q1(x): return "null" if x is None else "'" + x.replace("'", "''") + "'"
colvals = ",".join(f"('{t}',array[{','.join(q1(c) for c in sorted(cs))}])" for t, cs in sorted(cols.items()))
embvals = ",".join(f"({q1(p)},{q1(c)},{q1(k)})" for p, c, k in sorted(embeds, key=str))
rpcvals = ",".join(f"({q1(k)},{q1(a)})" for k, v in sorted(q["rpc"].items()) for a in (sorted(v) or [None]))
bkt = ",".join(f"({q1(b)})" for b in sorted(q["buckets"]))
print(f"""with app_tab(tbl, cols) as (values {colvals}), app_cols as (select tbl, unnest(cols) as col from app_tab),
app_embeds(parent, child, con) as (values {embvals}),
app_rpc(fn, arg) as (values {rpcvals}),
app_bucket(id) as (values {bkt})
select 'missing table' as kind, tbl as what from app_tab a where not exists (select 1 from information_schema.tables t where t.table_schema='public' and t.table_name=a.tbl)
union all select 'missing column', tbl||'.'||col from app_cols a where exists (select 1 from information_schema.tables t where t.table_schema='public' and t.table_name=a.tbl) and not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=a.tbl and c.column_name=a.col)
union all select 'embed: named key wrong', parent||' -> '||child||' via '||con from app_embeds e where con is not null and not exists (select 1 from pg_constraint c where c.conname=e.con and c.contype='f' and ((c.conrelid::regclass::text=e.parent and c.confrelid::regclass::text=e.child) or (c.conrelid::regclass::text=e.child and c.confrelid::regclass::text=e.parent)))
union all select 'embed: bare with '||n||' paths', parent||' -> '||child from (select parent, child, (select count(*) from pg_constraint c where c.contype='f' and ((c.conrelid::regclass::text=e.parent and c.confrelid::regclass::text=e.child) or (c.conrelid::regclass::text=e.child and c.confrelid::regclass::text=e.parent))) as n from app_embeds e where con is null) z where n <> 1
union all select 'missing rpc', fn from (select distinct fn from app_rpc) r where not exists (select 1 from pg_proc p where p.proname=r.fn and p.pronamespace='public'::regnamespace)
union all select 'rpc arg not in signature', fn||'('||arg||')' from app_rpc r where arg is not null and not exists (select 1 from pg_proc p where p.proname=r.fn and p.pronamespace='public'::regnamespace and r.arg = any(p.proargnames))
union all select 'missing bucket', id from app_bucket b where not exists (select 1 from storage.buckets s where s.id=b.id)
order by 1, 2;""")
