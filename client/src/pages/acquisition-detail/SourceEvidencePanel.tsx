import { ProvenanceLabel } from '../../design-system';
import type { AcquisitionDetail } from '../../lib/acquisitionDetailApi';
import { Fact, FactGrid, Panel, PublicId, SourceValue } from './detailPresentation';

/**
 * Where this record came from, and which of these identifiers is ours.
 *
 * TWO DELIBERATELY DIFFERENT KINDS OF IDENTITY LIVE HERE.
 *
 * `sourceRecordRowKey` is a RAW SOURCE ROW KEY — whatever the exporting system
 * happened to call that row. It is not an RV public ID, it carries no governed
 * guarantee, and it must never be styled as though it did: an operator who
 * pastes a source row key where a governed identity belongs gets a silent
 * mismatch, not an error.
 *
 * `sourceImportJobPublicId` is the SOURCE import job's public ID. It belongs to
 * the import system, not to the acquisition-import bookkeeping, which has no
 * governed public ID at all.
 *
 * No identifier here is linked. This application cannot navigate to source
 * evidence, and a link that goes nowhere is a worse answer than plain text.
 */
export function SourceEvidencePanel({ detail }: { readonly detail: AcquisitionDetail }) {
  const { sourceEvidence } = detail;

  return (
    <Panel
      title="Source evidence"
      description={<ProvenanceLabel kind="imported" meaningVisibility="full" />}
    >
      <FactGrid columns={3}>
        <Fact label="Source system">
          <PublicId>{sourceEvidence.sourceSystemPublicId}</PublicId>
        </Fact>

        <Fact
          label="Source record row key"
          hint="A raw key from the source system. Not a Russell Vault governed identity."
        >
          {sourceEvidence.sourceRecordRowKey ? (
            <SourceValue>{sourceEvidence.sourceRecordRowKey}</SourceValue>
          ) : (
            'No source row key recorded'
          )}
        </Fact>

        <Fact label="Source import job" hint="The public identity of the import job in the source system.">
          {sourceEvidence.sourceImportJobPublicId ? (
            <SourceValue>{sourceEvidence.sourceImportJobPublicId}</SourceValue>
          ) : (
            'No source import job recorded'
          )}
        </Fact>
      </FactGrid>

      <p className="text-xs text-ink-muted">
        Source evidence is retained separately from the governed record. Nothing here implies that record-level
        historical reconciliation has been performed.
      </p>
    </Panel>
  );
}
