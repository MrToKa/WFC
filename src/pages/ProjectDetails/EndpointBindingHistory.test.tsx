import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EndpointBindingHistory } from './EndpointBindingHistory';
import { endpointBindingFixture, endpointIds } from '@/test/endpointBindingFixtures';
import { endpointBindingSchema } from '../../../shared/pathfinderEndpointBindings';
describe('immutable endpoint history', () => {
  it('retains old/new point, displacement, reason and unverified frame in readable stacked rows', () => {
    const { history } = endpointBindingFixture();
    const binding = history.bindings[0];
    binding.priorPointProjectMetres = [0.25, 2, 3];
    binding.priorCaptureFrameId = binding.captureFrameId;
    binding.displacementBasis = 'same-capture-frame';
    binding.supersedesBindingId = endpointIds.key;
    binding.displacementVectorMetres = [1, 0, 0];
    binding.displacementMetres = 1;
    endpointBindingSchema.parse(binding);
    const onPage = vi.fn();
    render(
      <EndpointBindingHistory
        history={{ ...history, nextBeforeRevision: '1' }}
        busy={false}
        onPage={onPage}
      />,
    );
    expect(screen.getByRole('article', { name: 'Binding revision 1' })).toHaveStyle({
      minWidth: '0',
      wordBreak: 'normal',
    });
    expect(screen.getByText('0.25, 2, 3')).toBeInTheDocument();
    expect(screen.getByText('1.25, 2, 3')).toBeInTheDocument();
    expect(screen.getByText('1; vector 1, 0, 0')).toBeInTheDocument();
    expect(screen.getByText(/does not establish cross-revision alignment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Older history' }));
    expect(onPage).toHaveBeenCalledWith('1');
  });
  it.each([endpointIds.model, null])(
    'retains equal-valued points but refuses to show zero displacement across unverified frames (%s)',
    (priorFrame) => {
      const { history } = endpointBindingFixture(),
        binding = history.bindings[0];
      binding.priorPointProjectMetres = [...binding.pointProjectMetres];
      binding.priorCaptureFrameId = priorFrame;
      binding.displacementBasis = 'unverified-frames';
      binding.supersedesBindingId = endpointIds.key;
      endpointBindingSchema.parse(binding);
      render(<EndpointBindingHistory history={history} busy={false} onPage={vi.fn()} />);
      expect(screen.getAllByText('1.25, 2, 3')).toHaveLength(2);
      expect(
        screen.getByText(/Physical displacement has not been established/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^0; vector/)).not.toBeInTheDocument();
      if (priorFrame === null)
        expect(screen.getByText('Unknown historical frame')).toBeInTheDocument();
    },
  );
});
