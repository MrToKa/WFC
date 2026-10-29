import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RevisionMappingReview } from './RevisionMappingReview';
import { revisionComparisonFixture, revisionIds as ids } from '@/test/revisionComparisonFixtures';
describe('explicit reviewed mapping', () => {
  it('requires authoritative subject head plus an explicit acknowledgement and invalidates it when evidence changes', () => {
    const f = revisionComparisonFixture(),
      onLoadHead = vi.fn(),
      onSave = vi.fn();
    const query = { kind: 'object-mapping', sourceObjectRevisionIds: [ids.sourceObject] };
    const props = {
      manifest: f.manifest,
      change: f.page.changes[0],
      capabilities: f.context.capabilities,
      head: f.head,
      headQueryKey: JSON.stringify(query),
      disabled: false,
      onLoadHead,
      onSave,
    };
    render(<RevisionMappingReview {...props} />);
    fireEvent.click(
      screen.getByRole('checkbox', { name: new RegExp(`Candidate ${ids.targetObject}`) }),
    );
    fireEvent.change(screen.getByLabelText('Reviewed relationship'), {
      target: { value: 'unique' },
    });
    fireEvent.change(screen.getByLabelText('Revision evidence reviewed'), {
      target: { value: 'Explicit synthetic association; no local qualification' },
    });
    fireEvent.change(screen.getByLabelText('Revision decision reason'), {
      target: { value: 'Reviewed synthetic candidates' },
    });
    expect(screen.getByRole('button', { name: 'Save reviewed decision' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Load current review state' }));
    expect(onLoadHead).toHaveBeenCalledWith(query);
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed these exact/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed decision' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'object-mapping',
        expectedComparisonRevision: '1',
        expectedHeadId: null,
        body: expect.objectContaining({
          sourceObjectRevisionIds: [ids.sourceObject],
          targetObjectRevisionIds: [ids.targetObject],
          disposition: 'unique',
        }),
      }),
    );
    fireEvent.change(screen.getByLabelText('Revision evidence reviewed'), {
      target: { value: 'Changed evidence' },
    });
    expect(screen.getByRole('button', { name: 'Save reviewed decision' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /I reviewed these exact/ })).not.toBeChecked();
  });
  it('never provides an identity transform, default tolerances or automatic engineering approval for frame review', () => {
    const f = revisionComparisonFixture();
    render(
      <RevisionMappingReview
        manifest={f.manifest}
        change={null}
        capabilities={f.context.capabilities}
        head={null}
        headQueryKey={null}
        disabled={false}
        onLoadHead={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Revision review type'), {
      target: { value: 'frame-mapping' },
    });
    expect(screen.getByLabelText('Reviewed source to target matrix')).toHaveValue('');
    expect(screen.getByLabelText('Numerical validation tolerance')).toHaveValue('');
    expect(screen.getByLabelText('Engineering tolerance in metres')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Load current review state' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save reviewed decision' })).toBeDisabled();
  });
});
