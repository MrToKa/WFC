import type { BarrierPublicationRefusalReceipt } from '../../../shared/pathfinderBarrierOutcomes';

const budgetCodes = new Set(['CAPTURE_BYTES_LIMIT', 'ARRAY_COUNT_LIMIT', 'GEOMETRY_COUNT_LIMIT', 'SHELL_COUNT_LIMIT',
  'WORK_LIMIT', 'DEADLINE_EXCEEDED', 'RECEIPT_BYTES_LIMIT', 'FRAGMENT_LIMIT', 'PARENT_LIMIT', 'COMPONENT_LIMIT',
  'ESTIMATED_MEMORY_LIMIT', 'RESOURCE_LIMIT', 'INVALID_LIMITS']);

/** A refusal is about the captured geometry, not the viewer's current selection.
 * Source IDs are supplied only when the verifier tied them to the exact capture. */
export function barrierRefusalMessage(receipt: BarrierPublicationRefusalReceipt): string {
  const kept = 'The barrier set was not saved. The previously published barriers were kept.';
  if (!receipt.diagnostics?.length) return `${kept} No detailed verification reason was recorded for this attempt. Check the server's barrier verification diagnostics before changing the selection.`;
  const details = receipt.diagnostics.map(diagnostic => {
    const source = diagnostic.objectIds?.length ? ` Object${diagnostic.objectIds.length === 1 ? '' : 's'}: ${diagnostic.objectIds.join(', ')}.` : '';
    return `${diagnostic.message} (${diagnostic.code}).${source}`;
  }).join(' ');
  const action = receipt.diagnostics.some(diagnostic => budgetCodes.has(diagnostic.code)
    || ((diagnostic.code === 'CLOSED_SOLID_QUALIFICATION_REFUSED' || diagnostic.code === 'KERNEL_QUALIFICATION_REFUSED')
      && / Verification reason: (?:[a-z_]+, )*(?:resource_limit|deadline_exceeded|invalid_limits)(?:, |\.)/u.test(diagnostic.message)))
    ? 'Reduce the captured scope or ask the administrator to check the verifier limits before retrying.'
    : 'Check the reported geometry and its export from the source model before retrying.';
  return `${kept} ${details} ${action}`;
}
