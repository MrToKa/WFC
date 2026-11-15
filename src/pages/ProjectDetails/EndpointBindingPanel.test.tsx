import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EndpointBindingPanel, type EndpointBindingPanelProps } from './EndpointBindingPanel';
import { useEndpointBinding } from './hooks/useEndpointBinding';
import { endpointBindingFixture, endpointIds as ids } from '@/test/endpointBindingFixtures';
vi.mock('./hooks/useEndpointBinding', () => ({ useEndpointBinding: vi.fn() }));
function setup() {
  const fixture = endpointBindingFixture();
  const state = {
    context: fixture.context,
    history: fixture.history,
    objects: null,
    enabled: true,
    busy: false,
    unknown: false,
    conflict: false,
    error: null,
    save: vi.fn(),
    retry: vi.fn(),
    discardRefresh: vi.fn(),
    historyPage: vi.fn(),
    loadObjects: vi.fn(),
    migration: null,
    evaluateMigration: vi.fn(),
    confirmMigration: vi.fn(),
  };
  const props: EndpointBindingPanelProps = {
    projectId: ids.project,
    loadedProjectId: ids.project,
    token: 'token',
    isAdmin: true,
    locationId: ids.location,
    contextKey: 'model-A',
    pickPoint: vi.fn().mockResolvedValue({
      objectId: 23,
      point: [12.25, -3, 4.5],
      derivation: 'picked-surface-point',
    }),
    cancelPicking: vi.fn(),
  };
  vi.mocked(useEndpointBinding).mockReturnValue(
    state as unknown as ReturnType<typeof useEndpointBinding>,
  );
  return { ...fixture, state, props };
}
beforeEach(() => vi.clearAllMocks());
describe('narrow shared endpoint editor', () => {
  it('mounts and confirms a shared location on LAN HTTP without randomUUID or SubtleCrypto', async () => {
    const sourceCrypto = globalThis.crypto;
    const getRandomValues = vi.fn((bytes: Uint8Array) => sourceCrypto.getRandomValues(bytes));
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      const { state, props } = setup();
      render(<EndpointBindingPanel {...props} />);
      expect(globalThis.crypto.randomUUID).toBeUndefined();
      expect(globalThis.crypto.subtle).toBeUndefined();
      expect(screen.getByRole('region', { name: 'Shared endpoint binding' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Pick surface point in 3D' }));
      await waitFor(() => expect(screen.getByLabelText('Endpoint X in metres')).toHaveValue('12.25'));
      fireEvent.change(screen.getByLabelText('Reason for confirmation'), {
        target: { value: 'Reviewed location on the LAN' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
      expect(state.save).toHaveBeenCalledOnce();
      expect(state.save.mock.calls[0][0]).toMatchObject({
        mode: 'fixed-world',
        pointProjectMetres: [12.25, -3, 4.5],
        idempotencyKey: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
      });
      expect(getRandomValues.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('shows unavailable migration evidence without offering confirmation or moving the old point', () => {
    const f = setup();
    f.state.migration = f.migration as never;
    render(<EndpointBindingPanel {...f.props} />);
    expect(screen.getByRole('article', { name: 'Endpoint migration review' })).toBeInTheDocument();
    expect(screen.getByText('frame unverified')).toBeInTheDocument();
    expect(screen.getByText(/old binding has not been moved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm reviewed carry' })).toBeDisabled();
  });
  it('shows all-cable shared usage, disables unproven Follow and saves a picked point as fixed-world', async () => {
    const { state, props } = setup();
    render(
      <div style={{ width: 300 }}>
        <EndpointBindingPanel {...props} />
      </div>,
    );
    expect(screen.getByText(/Used by 4 cables: 2 From and 3 To/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Follow model object' })).toBeDisabled();
    expect(
      screen.getByText(/verified object-local frame and durable attachment/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pick surface point in 3D' }));
    await waitFor(() => expect(screen.getByLabelText('Endpoint X in metres')).toHaveValue('12.25'));
    fireEvent.change(screen.getByLabelText('Reason for confirmation'), {
      target: { value: 'Reviewed picked connection' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'fixed-world',
        derivation: 'picked-surface-point',
        pointProjectMetres: [12.25, -3, 4.5],
        provenanceObject: null,
        location: { name: 'Synthetic equipment', aliases: ['Shared  alias'] },
      }),
    );
    expect(screen.getByRole('region', { name: 'Shared endpoint binding' })).toHaveStyle({
      minWidth: '0',
      wordBreak: 'normal',
    });
  });
  it('sends object-derived evidence without a client point and clearly labels the anchor approximate', () => {
    const { state, props } = setup();
    const page = {
      schemaVersion: 'wfc.pf.geometry-object-page.v1',
      projectId: ids.project,
      traceId: ids.trace,
      contentSha256: 'a'.repeat(64),
      offset: 0,
      limit: 25,
      total: 2,
      nextOffset: null,
      objects: [
        {
          id: ids.object,
          objectId: 'dbid:23',
          name: 'Synthetic object',
          geometryRole: 'object',
          recordSha256: 'c'.repeat(64),
        },
        {
          id: ids.actor,
          objectId: 'dbid:24',
          name: 'Synthetic routing leaf',
          geometryRole: 'routing-leaf',
          recordSha256: 'd'.repeat(64),
        },
      ],
    };
    state.objects = page as never;
    render(<EndpointBindingPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Reason for confirmation'), { target: { value: 'Approximate anchor reviewed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose object dbid:24' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Object-derived anchor' }));
    expect(screen.getByRole('button', { name: 'Choose object dbid:24' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm shared endpoint' })).toBeDisabled();
    expect(
      screen.getByText(/approximate anchor is not a verified physical terminal/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose object dbid:23' }));
    fireEvent.change(screen.getByLabelText('Reason for confirmation'), {
      target: { value: 'Approximate anchor reviewed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    const command = state.save.mock.calls[0][0];
    expect(command).toMatchObject({
      mode: 'object-derived',
      object: { traceId: ids.trace, objectRevisionId: ids.object, recordSha256: 'c'.repeat(64) },
      anchorRule: 'equipment-bottom-aabb.v1',
    });
    expect(command).not.toHaveProperty('pointProjectMetres');
  });
  it('freezes edits for unknown save and discards a late protected pick after the context changes', async () => {
    const { state, props } = setup();
    let resolve!: (value: {
      objectId: number;
      point: [number, number, number];
      derivation: 'picked-surface-point';
    }) => void;
    props.pickPoint = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<EndpointBindingPanelProps['pickPoint']>>>((done) => {
          resolve = done;
        }),
    );
    const { rerender } = render(<EndpointBindingPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick surface point in 3D' }));
    rerender(<EndpointBindingPanel {...props} contextKey="model-B" />);
    resolve({ objectId: 23, point: [99, 99, 99], derivation: 'picked-surface-point' });
    await waitFor(() =>
      expect(screen.getByLabelText('Endpoint X in metres')).not.toHaveValue('99'),
    );
    expect(props.cancelPicking).toHaveBeenCalled();
    state.unknown = true;
    rerender(<EndpointBindingPanel {...props} contextKey="model-B" />);
    expect(screen.getByLabelText('Location name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm shared endpoint' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile same save' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it('does not mount any binding state or controls for nonadministrators', () => {
    const { props } = setup();
    vi.mocked(useEndpointBinding).mockClear();
    render(<EndpointBindingPanel {...props} isAdmin={false} />);
    expect(useEndpointBinding).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
