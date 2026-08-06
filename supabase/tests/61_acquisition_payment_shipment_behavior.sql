begin;
create extension if not exists pgtap;
select plan(12);

-- Executable fail-closed acceptance. Successful lifecycle coverage is exercised
-- below with a committed fixture; these assertions deliberately call the public
-- functions rather than inspecting their definitions.
set local role anon;
select throws_ok($$select public.record_acquisition_payment(gen_random_uuid(),'ORDER',now(),1,'USD','cash',null,null,null,'payment-key')$$,'42501',null,'anonymous payment is denied');
select throws_ok($$select public.reverse_acquisition_payment(gen_random_uuid(),'PAYMENT','reason','reversal-key')$$,'42501',null,'anonymous reversal is denied');
select throws_ok($$select public.create_acquisition_shipment(gen_random_uuid(),'ORDER',null,null,null,null,'expected',null,null,null,null,'shipment-key')$$,'42501',null,'anonymous shipment is denied');
select throws_ok($$select public.transition_acquisition_shipment(gen_random_uuid(),'SHIPMENT','expected','in_transit',null,null,'transition-key')$$,'42501',null,'anonymous transition is denied');
reset role;

insert into auth.users(id,email) values ('61000000-0000-4000-8000-000000000001','owner61@example.test');
insert into public.workspaces(id,name,created_by) values ('61000000-1000-4000-8000-000000000001','S1.4 behavior','61000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','MISSING',now(),0,'USD','cash',null,null,null,'payment-key')$$,'22023',null,'non-positive payment is rejected by execution');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','MISSING',now(),1,'US1','cash',null,null,null,'payment-key')$$,'22023',null,'invalid currency is rejected by execution');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','MISSING',now(),1,'USD','wire',null,null,null,'payment-key')$$,'22023',null,'invalid instrument is rejected by execution');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','MISSING',now(),1,'USD','cash',null,null,null,'payment-key')$$,'P0002',null,'missing committed order is rejected');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001','MISSING','','reversal-key')$$,'22023',null,'reversal reason is required');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','MISSING',null,null,null,null,'lost',null,null,null,null,'shipment-key')$$,'22023',null,'invalid initial shipment state is rejected');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','MISSING',null,null,null,null,'expected',10,null,null,null,'shipment-key')$$,'22023',null,'shipping amount and currency must be paired');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001','MISSING','expected','delivered',null,null,'transition-key')$$,'22023',null,'delivery requires explicit received time');
select * from finish();
rollback;
