# Runbook: Hosted Supabase Migration Parity

**Purpose:** determine whether the hosted Supabase project has the same
migrations as this repository, so an operator can tell "the dashboard is broken"
apart from "the dashboard's database update has not been applied yet."

**Who runs this:** Kyle / an owner-admin with Supabase access. Claude Code and CI
**cannot** run these steps and must never claim hosted parity exists.

**This runbook is read-only.** It tells you what is missing. It does not apply
anything. Applying migrations is a separate, explicitly authorized action.

## When you need this

Run it when a dashboard panel shows:

> This dashboard panel is not available because the required database update has
> not been applied.

That message means the server asked for a governed function the hosted database
did not have. It is a **deployment-parity** answer, not a data answer — no count
has been guessed at, and no zero has been substituted.

It is also worth running before any release that depends on migrations
`20260801000100` and later (media hardening, Listing Prep, operations dashboard,
and the repair-pass corrections).

## Step 0 — establish which project you are actually connected to

**Do this first, every time. Do not skip it because you "know" which project it is.**

At least two real Russell Vault databases exist. Both are plausible-looking, and canonical repository documents named the wrong one as the Supabase project until 2026-08-22. A parity check run against the wrong database produces a confident, entirely false answer.

1. Read the Supabase URL from the **deployed Railway service** environment (`VITE_SUPABASE_URL`), not from any document, not from memory, and not from a Supabase project display name. The project ref is the subdomain: `https://<ref>.supabase.co`.
2. Confirm the SQL editor or connection you are about to use belongs to that exact ref.
3. Record the ref and where you read it from. Every later step in this runbook is a claim about *that* database and no other.

A scoped Supabase project listing is not a census: a project can be missing from the list and still exist and be reachable. Absence from a listing is never evidence that a project does not exist.

If you cannot read the deployed configuration, stop. Report that production identity is unverified rather than proceeding against a guess.

## Step 1 — list what the repository expects

From a checkout of the branch you intend to release:

```bash
ls supabase/migrations/*.sql | xargs -n1 basename | sed 's/\.sql$//' | sort
ls supabase/migrations/*.sql | wc -l      # expected migration count
```

Do not rely on a count written in any document, including this one. Documents go
stale; the directory does not.

## Step 2 — list what the hosted project actually has

In the Supabase SQL editor for the hosted project:

```sql
select migration_name
  from public.schema_migrations_log
 order by migration_name;
```

```sql
select count(*) from public.schema_migrations_log;
```

`schema_migrations_log` is the repository's own ledger — every migration appends
one row as its last statement — so it reflects what was actually applied to
*this* database, not what someone intended to apply.

## Step 3 — compare

Paste the repository list from Step 1 and the hosted list from Step 2 into any
diff. Names present in the repository and absent from the host are the gap.

For a quick check of just the surfaces this release depends on:

```sql
select m.expected,
       (select count(*) from public.schema_migrations_log l
         where l.migration_name = m.expected) = 1 as applied
from (values
  ('20260801000100_media_hardening_schema'),
  ('20260801000200_media_hardening_functions'),
  ('20260801000300_media_readiness_and_issues'),
  ('20260801000400_media_workbench_summary'),
  ('20260801000500_listing_prep_schema'),
  ('20260801000600_listing_prep_readiness'),
  ('20260801000700_listing_prep_lifecycle'),
  ('20260801000800_listing_prep_bulk_and_presets'),
  ('20260801000900_operations_dashboard_contracts')
) as m(expected)
order by m.expected;
```

Any row with `applied = false` is a migration the hosted project is missing.
Extend the `values` list with any newer migration names from Step 1 — the list
above is a convenience, not the authority.

## Step 4 — confirm the specific dashboard contract

The panel that failed in production depends on one function. This answers
directly whether it exists:

```sql
select exists (
  select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_operations_inventory_health'
) as dashboard_health_contract_present;
```

A `false` here with `20260801000900` absent from the ledger is a consistent
picture: the migration was never applied.

A `false` here with `20260801000900` **present** in the ledger is not — it means
the ledger and the schema disagree, which is a more serious condition. Stop and
investigate rather than re-applying.

## Step 5 — record the result

Write down, with the date and the project reference:

- the project ref from Step 0 **and where you read it from**;
- the repository migration count and the branch/SHA it came from;
- the hosted count;
- the exact list of missing names;
- whether `get_operations_inventory_health` exists.

That record is what makes a later release decision reviewable. Without it,
"parity was checked" is an unverifiable claim.

## What this runbook deliberately does not do

- It does not apply migrations.
- It does not modify hosted data, roles, grants, or policies.
- It does not deploy or restart anything.
- It does not establish Gate G0A. See
  [`railway-backup-deploy-preflight.md`](railway-backup-deploy-preflight.md).

Applying the missing migrations is a separate authorized action, taken after a
verified backup, and verified afterwards by re-running Steps 2 to 4.
