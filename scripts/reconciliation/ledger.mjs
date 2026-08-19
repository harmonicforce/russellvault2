export async function persistResult(rpc, result, options) {
  const begin = await rpc('begin_reconciliation_run', {
    p_workspace_id: options.workspaceId, p_domain: result.domain, p_source_label: options.sourceLabel,
    p_source_sha256: result.sourceArtifact.sha256, p_target_scope: options.targetScope,
    p_comparison_key: result.comparisonKey, p_tool_version: result.tool,
    p_actor_process: options.actorProcess ?? 'reconciliation.runner', p_idempotency_key: options.idempotencyKey,
  });
  const runPublicId = begin.runPublicId;
  try {
    for (const finding of result.findings) {
      await rpc('record_reconciliation_finding', {
        p_workspace_id: options.workspaceId, p_run_public_id: runPublicId,
        p_comparison_key_value: String(finding.comparisonKeyValue), p_verdict: finding.verdict,
        p_field_differences: finding.fieldDifferences, p_materiality: finding.materiality,
        p_evidence: { sourceSha256: result.sourceArtifact.sha256, targetSha256: result.targetArtifact.sha256 },
        p_actor_process: options.actorProcess ?? 'reconciliation.runner',
      });
    }
    await rpc('complete_reconciliation_run', { p_workspace_id: options.workspaceId, p_run_public_id: runPublicId, p_l1_result: result.l1 });
  } catch (error) {
    await rpc('fail_reconciliation_run', {
      p_workspace_id: options.workspaceId, p_run_public_id: runPublicId, p_l1_result: result.l1,
      p_failure_note: 'offline reconciliation persistence failed',
    });
    throw error;
  }
  return runPublicId;
}
