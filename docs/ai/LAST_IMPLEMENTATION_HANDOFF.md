# Last Implementation Handoff

## S1.4 final behavioral acceptance

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `codex/s1-4-final-behavioral-acceptance`.
- Base: `5bc5976b92d7600b0d63888025d8d771753b1c2c` (no drift from expected main).
- PR #46 canonical head: `2845ae04a1f5af99eb8d3250a80b96c121f8b0f5`.
- PR #46 merge commit: `5bc5976b92d7600b0d63888025d8d771753b1c2c`.
- At verification start no exact-head PR #46 CI run was available; tests 59 and 60 were structural only.
- Reproduced defects: workspace-only line ambiguity, deferred multiple placements, carrier/tracking display normalization, inferred delivery time, absent durable client retry, omitted typed histories, and shared action-reason state.
- Additive migration: `20260806000400_acquisition_s1_4_final_acceptance.sql` (repository migration count 66). Migrations 00200 and 00300 remain unchanged.
- Identity contract: workspace + governed source-system public ID + acquisition-line public ID. Legacy wrappers fail closed on ambiguity.
- Shipment display evidence is preserved; initial delivered/lost/cancelled creation is rejected; delivery requires an explicit governed transition timestamp.
- Client renders reversal and transition history and retains exact retry variables/key separately for payment, reversal, shipment, and transition operations. Stale transitions refetch and require a new confirmation.
- Live Supabase, Railway, deployment, and hosted acceptance: not authorized/not checked. No production data touched.
- Rollback: revert this branch commit; the migration is additive and has not been applied to hosted Supabase.
- Next decision: merge only after the exact PR head has all four required CI jobs green; begin S1.5 only afterward.
