begin;
select plan(22);

select has_function('app','get_acquisition_classification_input',array['uuid'],'classification input helper exists');
select has_function('app','evaluate_acquisition_classification',array['uuid'],'classification evaluator exists');
select has_function('public','classify_acquisition_line',array['uuid'],'public classifier exists');
select has_function('public','override_acquisition_line_classification',array['uuid','text','text'],'owner override exists');
select has_function('public','create_classification_rule',array['uuid','text','text','text','text','text','text','text','text','integer','text'],'rule creation exists');
select has_function('public','supersede_classification_rule',array['uuid','integer','text','text','text','text','text','text','integer','text'],'rule supersession exists');

select isnt_empty($$select 1 from public.classification_rules where status='active' and logical_key='explicit_evidence:legacy_sealed_line_ids'$$,'explicit evidence placeholder is active seed data');
select is((select app.regex_flags_supported('imsx')),'t','supported regex flags are closed to imsx');
select is((select app.regex_flags_supported('g')),'f','unsupported regex flags are rejected by helper');
select is(app.acquisition_delivered_item_title('Prefix - Middle - PSA 10 Charizard'),'PSA 10 Charizard','delivered item uses final dash only');
select is(app.acquisition_delivered_item_title('No dash title'),'No dash title','delivered item falls back to full title');

select throws_ok($$select app.validate_classification_rule_payload('regex','full_title','abc','g',null)$$,'22023',null,'invalid regex flags fail closed');
select throws_ok($$select app.validate_classification_rule_payload('exact','full_title',null,null,null)$$,'22023',null,'invalid exact payload fails closed');
select lives_ok($$select app.validate_classification_rule_payload('evidence_set','acquisition_line_id',null,null,null)$$,'evidence-set payload validates');

select has_function_privilege('authenticated','public.classify_acquisition_line(uuid)','execute'),'authenticated can execute classifier';
select hasnt_function_privilege('anon','public.classify_acquisition_line(uuid)','execute'),'anon cannot execute classifier';
select hasnt_function_privilege('authenticated','app.evaluate_acquisition_classification(uuid)','execute'),'authenticated cannot execute internal evaluator';
select hasnt_table_privilege('authenticated','public.acquisition_line_classifications','insert'),'authenticated cannot directly insert classifications';
select hasnt_table_privilege('authenticated','public.classification_rules','insert'),'authenticated cannot directly insert rules';

select col_is_fk('public','acquisition_line_classifications','supersedes_classification_id','classification supersession remains FK-backed');
select has_index('public','acquisition_line_classifications','acquisition_line_classifications_one_current_uidx','one current classification index remains');
select has_index('public','classification_rules','classification_rules_one_active_logical_uidx','one active logical rule index remains');

select * from finish();
rollback;
