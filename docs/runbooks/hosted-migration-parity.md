# Runbook: Hosted Supabase Migration Parity

**Purpose:** determine whether the Supabase project actually used by the deployed Russell Vault application has the same governed migrations as this repository.

This separates three different questions that must never be collapsed:

1. which Supabase project is production;
2. which migrations the repository expects;
3. which migrations that exact hosted project has actually applied.

**This runbook is read-only.** It tells you what is missing or divergent. Applying migrations is a separate, explicitly authorized action.

## Current reviewed deployment identity

As of the 2026-08-21 state review, Railway's deployed `VITE_SUPABASE_URL` points to:

`https://ncyqqitqtsyjrijieykd.supabase.co`

so the reviewed production project ref is:

`ncyqqitqtsyjrijieykd`

Do **not** treat that line as permanent authority. Re-verify the deployed environment every time production identity matters.

`ykdyqnvmwpxhowbwhzqz` is a different Supabase project and is not the project configured by the reviewed Railway deployment.

## Step 0 — establish the production project first

Before opening Supabase or running any SQL, inspect the deployed Railway service variables and read the actual Supabase URL used by the application:

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
```

If server-side Supabase URL variables are present, confirm they point to the same ref.

Record:

- Railway project/environment/service;
- deployed branch and commit SHA;
- exact Supabase project ref extracted from the deployed URL;
- UTC time of the check.

Do not choose a database because its display name looks right. Do not choose it because a stale repository document names it. Do not treat a scoped Supabase `list_projects` response as a census of every project that may exist or be addressable.

If the deployed variables disagree with one another, **STOP**. That is a configuration defect, not a migration-parity problem.

## Step 1 — list what the repository expects

From a checkout of the exact branch/SHA you intend to release:

```bash
ls supabase/migrations/*.sql | xargs -n1 basename | sed 's/\.sql$//' | sort
ls supabase/migrations/*.sql | wc -l
```

Do not rely on a count written in a document, including this one. Documents can go stale; the exact checked-out migration directory is the repository authority.

The repository's pgTAP migration-ledger regression must expect the same set. A disagreement between the directory and its regression is a repository defect and must be repaired before release.

## Step 2 — list what the verified hosted project actually has

Only after Step 0 has established the production ref, query that exact project:

```sql
select id, migration_name, applied_at
  from public.schema_migrations_log
 order by id;
```

Also capture:

```sql
select count(*) as rows,
       count(distinct migration_name) as distinct_names,
       min(id) as min_id,
       max(id) as max_id,
       min(applied_at) as first_apply,
       max(applied_at) as last_apply
  from public.schema_migrations_log;
```

`schema_migrations_log` is the repository's governed ledger. Each repository migration appends its own name, so this is evidence about what was applied to **this database**, not what a deployment or agent intended to apply.

## Step 3 — compare names, not just totals

Compare the exact repository migration-name set from Step 1 with the hosted set from Step 2.

A matching count alone is insufficient. Detect and record:

- repository names missing on the host;
- host ledger names absent from the repository;
- duplicate hosted migration names;
- ordering/history anomalies that require explanation.

The hosted database may carry reviewed compatibility history not represented as a normal repository migration. Record such differences explicitly rather than silently calling the schemas byte-identical.

## Step 4 — verify critical resulting objects

After name parity is established, verify the objects the release depends on rather than trusting ledger rows alone.

Examples for the current Commercial Core state:

```sql
select
  to_regclass('public.acquisition_receipts') as acquisition_receipts,
  to_regclass('public.inventory_cost_basis') as inventory_cost_basis,
  to_regclass('public.reconciliation_runs') as reconciliation_runs,
  to_regproc('app.guard_acquisition_event_rows') as acquisition_guard;
```

For a release-specific check, query the exact tables/functions/views introduced by that release.

A migration name present in the ledger while its required schema object is absent is **not parity**. Stop and investigate. Do not blindly reapply the migration.

## Step 5 — record the result

Record, with UTC time:

- repository branch and exact SHA;
- repository migration count and exact latest migration name;
- Railway project/environment/service used to establish production identity;
- deployed Supabase URL's project ref;
- hosted ledger count and latest migration name;
- missing, extra, or duplicate migration names;
- critical-object checks;
- conclusion: `PARITY`, `DRIFT`, or `BLOCKED`.

That evidence is what makes a later release decision reviewable. “Parity was checked” without the project ref and comparison evidence is not sufficient.

## Current reviewed evidence

At the 2026-08-21 state review, the canonical deployed project `ncyqqitqtsyjrijieykd` had **79 / 79** governed migration-ledger parity through:

`20260819000200_null_safe_acquisition_mutation_guards`

This is a dated fact, not a substitute for Steps 0–5 on the next release.

## What this runbook deliberately does not do

- It does not apply migrations.
- It does not modify hosted data, roles, grants, or policies.
- It does not establish that two databases are byte-for-byte identical.
- It does not establish Gate G0A. See [`railway-backup-deploy-preflight.md`](railway-backup-deploy-preflight.md).
- It does not make green CI equivalent to hosted acceptance.

Applying missing migrations is a separate authorized action, taken only against the Step 0 verified production project and followed by a fresh parity check.
