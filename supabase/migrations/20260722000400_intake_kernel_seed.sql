-- Phase 6A intake kernel — migration 4: governed field registry, rules, and
-- reference lists (deterministic seed).
--
-- This is the single authoritative rule source. The server evaluates
-- applicability, requiredness, allowed values, type, category rules,
-- serialization requirements, and commit blockers from these rows; the client
-- may preview them but must not maintain a competing engine. Identity-driving
-- fields carry a `maps_to` target in the Phase 5 typed Product/SKU columns
-- (schema.table.column) — never an EAV identity bag. `is_factual` marks facts
-- that must never be given a fabricated default: acquisition source, cost,
-- condition, grade, grading company, certificate, defects, marketplace status.

-- Reference lists (governed allowed values) --------------------------------------------
insert into public.intake_reference_lists (list_key, label) values
  ('grading_company', 'Grading company'),
  ('tcg_condition', 'Raw TCG condition'),
  ('tcg_language', 'TCG language'),
  ('tcg_product_format', 'TCG product format'),
  ('footwear_condition', 'Footwear condition');

insert into public.intake_reference_options (list_key, option_value, label, sort_order) values
  ('grading_company', 'PSA', 'PSA', 1),
  ('grading_company', 'CGC', 'CGC', 2),
  ('grading_company', 'BGS', 'Beckett (BGS)', 3),
  ('grading_company', 'SGC', 'SGC', 4),
  ('grading_company', 'TAG', 'TAG', 5),
  ('grading_company', 'AGS', 'AGS', 6),
  ('tcg_condition', 'Near Mint', 'Near Mint', 1),
  ('tcg_condition', 'Lightly Played', 'Lightly Played', 2),
  ('tcg_condition', 'Moderately Played', 'Moderately Played', 3),
  ('tcg_condition', 'Heavily Played', 'Heavily Played', 4),
  ('tcg_condition', 'Damaged', 'Damaged', 5),
  ('tcg_language', 'English', 'English', 1),
  ('tcg_language', 'Japanese', 'Japanese', 2),
  ('tcg_language', 'Other', 'Other', 3),
  ('tcg_product_format', 'Raw card', 'Raw card', 1),
  ('tcg_product_format', 'Graded slab', 'Graded slab', 2),
  ('tcg_product_format', 'Sealed product', 'Sealed product', 3),
  ('footwear_condition', 'New', 'New / Deadstock', 1),
  ('footwear_condition', 'Used', 'Used', 2);

-- Field registry ------------------------------------------------------------------------
-- field_key is globally unique and vertical-qualified; `maps_to`'s final path
-- segment is the exact attribute key the Phase 5 registrar reads.
insert into public.intake_field_registry
  (field_key, label, scope, business_vertical, data_type, reference_list_key, maps_to,
   is_identity_driving, is_factual) values
  -- TCG product identity
  ('tcg_set_name', 'Set name', 'product', 'tcg', 'text', null,
    'public.tcg_product_attributes.set_name', true, false),
  ('tcg_card_number', 'Card number', 'product', 'tcg', 'text', null,
    'public.tcg_product_attributes.card_number', true, false),
  ('tcg_featured_subject', 'Featured subject', 'product', 'tcg', 'text', null,
    'public.tcg_product_attributes.featured_subject', true, false),
  ('tcg_language', 'Language', 'product', 'tcg', 'reference', 'tcg_language',
    'public.tcg_product_attributes.language', true, false),
  -- TCG SKU identity (condition / grading are FACTUAL)
  ('tcg_condition_or_quality', 'Condition / quality', 'sku', 'tcg', 'reference', 'tcg_condition',
    'public.tcg_sku_attributes.condition_or_quality', true, true),
  ('tcg_grading_company', 'Grading company', 'sku', 'tcg', 'reference', 'grading_company',
    'public.tcg_sku_attributes.grading_company', true, true),
  ('tcg_numeric_grade', 'Numeric grade', 'sku', 'tcg', 'text', null,
    'public.tcg_sku_attributes.numeric_grade', true, true),
  ('tcg_grade_designation', 'Grade designation', 'sku', 'tcg', 'text', null,
    'public.tcg_sku_attributes.grade_designation', true, true),
  ('tcg_seal_or_packaging_condition', 'Seal / packaging condition', 'sku', 'tcg', 'text', null,
    'public.tcg_sku_attributes.seal_or_packaging_condition', true, true),
  ('tcg_product_format', 'Product format', 'sku', 'tcg', 'reference', 'tcg_product_format',
    'public.tcg_sku_attributes.product_format', true, false),
  -- TCG entry-level serialized fact (certificate is FACTUAL)
  ('tcg_certificate_number', 'Certificate number', 'entry', 'tcg', 'text', null,
    'public.inventory_items.certificate_number', false, true),
  -- Footwear product identity
  ('footwear_silhouette', 'Silhouette', 'product', 'footwear', 'text', null,
    'public.footwear_product_attributes.silhouette', true, false),
  ('footwear_colorway_name', 'Colorway', 'product', 'footwear', 'text', null,
    'public.footwear_product_attributes.colorway_name', true, false),
  ('footwear_style_code', 'Style code', 'product', 'footwear', 'text', null,
    'public.footwear_product_attributes.style_code', true, false),
  -- Footwear SKU identity
  ('footwear_shoe_size', 'Shoe size', 'sku', 'footwear', 'text', null,
    'public.footwear_sku_attributes.shoe_size', true, false),
  ('footwear_color', 'Color', 'sku', 'footwear', 'text', null,
    'public.footwear_sku_attributes.color', true, false),
  ('footwear_condition_or_quality', 'Condition / quality', 'sku', 'footwear', 'reference',
    'footwear_condition', 'public.footwear_sku_attributes.condition_or_quality', true, true);

-- Field rules ---------------------------------------------------------------------------
-- Graded TCG: grader + grade + certificate are required commit blockers; a
-- graded slab is one serialized unit (enforced additionally in the kernel).
insert into public.intake_field_rules
  (category, field_key, applicability, is_required, is_commit_blocker, condition) values
  ('graded_tcg', 'tcg_grading_company', 'always', true, true, '{}'),
  ('graded_tcg', 'tcg_numeric_grade', 'always', true, true, '{}'),
  ('graded_tcg', 'tcg_certificate_number', 'always', true, true, '{}'),
  ('graded_tcg', 'tcg_set_name', 'always', false, false, '{}'),
  ('graded_tcg', 'tcg_featured_subject', 'always', false, false, '{}'),
  -- Raw TCG: condition MAY be stated but uncertain/unknown is permitted (never a
  -- blocker, never fabricated).
  ('raw_tcg', 'tcg_condition_or_quality', 'always', false, false, '{}'),
  ('raw_tcg', 'tcg_featured_subject', 'always', false, false, '{}'),
  -- Sealed TCG: product format is meaningful; seal condition optional.
  ('sealed_tcg', 'tcg_product_format', 'always', false, false, '{}'),
  ('sealed_tcg', 'tcg_seal_or_packaging_condition', 'always', false, false, '{}'),
  -- Footwear: size is a required commit blocker; silhouette recommended.
  ('footwear', 'footwear_shoe_size', 'always', true, true, '{}'),
  ('footwear', 'footwear_silhouette', 'always', false, false, '{}'),
  ('footwear', 'footwear_condition_or_quality', 'always', false, false, '{}');

insert into public.schema_migrations_log (migration_name)
values ('20260722000400_intake_kernel_seed');
