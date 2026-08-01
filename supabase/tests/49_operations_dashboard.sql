begin;
create extension if not exists pgtap with schema public;
select plan(5);

select has_function('public', 'get_operations_inventory_health', array['uuid'],
  'dashboard health is a bounded governed aggregate');
select function_privs_are('public', 'get_operations_inventory_health', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated callers may execute the governed aggregate');
select function_privs_are('public', 'get_operations_inventory_health', array['uuid'], 'anon', array[]::text[],
  'anonymous callers cannot execute the governed aggregate');
select like(pg_get_viewdef('public.inventory_work_queue'::regclass), '%m.lifecycle = ''active''%',
  'missing-photo work counts only active media');
select like(pg_get_viewdef('public.inventory_work_queue'::regclass), '%i.item_state = ''active''%',
  'work queue excludes historical items');

select * from finish();
rollback;
