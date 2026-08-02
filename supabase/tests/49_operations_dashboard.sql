begin;
create extension if not exists pgtap with schema public;
select plan(5);

select has_function('public', 'get_operations_inventory_health', array['uuid'],
  'dashboard health is a bounded governed aggregate');
select function_privs_are('public', 'get_operations_inventory_health', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated callers may execute the governed aggregate');
select function_privs_are('public', 'get_operations_inventory_health', array['uuid'], 'anon', array[]::text[],
  'anonymous callers cannot execute the governed aggregate');
-- The plain-PostgreSQL pgTAP package does not expose a like(text, text, text)
-- overload. `matches` is the repository-established SQL-text assertion and
-- accepts pg_get_viewdef's text result in both database harnesses.
select matches(pg_get_viewdef('public.inventory_work_queue'::regclass),
  'm\.lifecycle[[:space:]]*=[[:space:]]*''active''',
  'missing-photo work counts only active media');
select matches(pg_get_viewdef('public.inventory_work_queue'::regclass),
  'i\.item_state[[:space:]]*=[[:space:]]*''active''',
  'work queue excludes historical items');

select * from finish();
rollback;
