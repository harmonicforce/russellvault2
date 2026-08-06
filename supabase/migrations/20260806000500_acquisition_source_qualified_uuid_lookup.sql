-- PostgreSQL has no built-in min(uuid). Select the sole governed identity only
-- after cardinality has been checked, preserving the fail-closed contract.
create or replace function public.classify_acquisition_line_by_source(p_workspace_id uuid,p_source_system_public_id text,p_acquisition_line_public_id text) returns jsonb language plpgsql security definer set search_path='' as $$ declare line_id uuid; n integer; begin
 perform app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]);
 select count(distinct acquisition_line_item_id),(array_agg(distinct acquisition_line_item_id))[1] into n,line_id from public.acquisition_line_overview where workspace_id=p_workspace_id and source_system_public_id=p_source_system_public_id and acquisition_line_public_id=p_acquisition_line_public_id;
 if n=0 then raise exception 'acquisition_not_found' using errcode='P0002'; elsif n>1 then raise exception 'acquisition_integrity_error' using errcode='23514'; end if;
 return public.classify_acquisition_line(line_id);
end $$;

create or replace function public.override_acquisition_line_classification_by_source(p_workspace_id uuid,p_source_system_public_id text,p_acquisition_line_public_id text,p_classification_option_key text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$ declare line_id uuid; n integer; begin
 perform app.assert_workspace_role(p_workspace_id,array['owner']::public.workspace_role[]);
 select count(distinct acquisition_line_item_id),(array_agg(distinct acquisition_line_item_id))[1] into n,line_id from public.acquisition_line_overview where workspace_id=p_workspace_id and source_system_public_id=p_source_system_public_id and acquisition_line_public_id=p_acquisition_line_public_id;
 if n=0 then raise exception 'acquisition_not_found' using errcode='P0002'; elsif n>1 then raise exception 'acquisition_integrity_error' using errcode='23514'; end if;
 return public.override_acquisition_line_classification(line_id,p_classification_option_key,p_reason);
end $$;
