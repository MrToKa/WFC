import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualSectionPlacement } from './ManualSectionPlacement';

type Props = ComponentProps<typeof ManualSectionPlacement>;
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const targetId = '00000000-0000-4000-8000-000000000003';
const routeId = '00000000-0000-4000-8000-000000000004';
const unknownCatalogId = '00000000-0000-4000-8000-000000000005';
const straightCatalogId = '00000000-0000-4000-8000-000000000006';
const sourcePoint = {
  point: [0.08, 0.21, 0.33] as [number, number, number],
  derivation: 'picked-surface-point' as const,
  cadInstanceId: firstId,
};

function fixture(overrides: Partial<Props> = {}) {
  const request = vi.fn<Props['request']>(async path => new Response(JSON.stringify(
    path === '/placement-targets' ? { targets: [] } : { instances: [] },
  ), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const pick = vi.fn<Props['pick']>().mockResolvedValue(sourcePoint);
  const onMoved = vi.fn<Props['onMoved']>().mockResolvedValue(undefined);
  const onBusyChange = vi.fn<Props['onBusyChange']>();
  const props: Props = {
    instances: [
      { id: firstId, catalogItemId: unknownCatalogId, partNumber: 'CUSTOM-TEE', revision: 3,
        xMm: 100, yMm: 200, zMm: 300, qx: 0, qy: 0, qz: Math.SQRT1_2, qw: Math.SQRT1_2 },
      { id: secondId, catalogItemId: unknownCatalogId, partNumber: 'CUSTOM-BEND', revision: 7,
        xMm: 500, yMm: 600, zMm: 700, qx: 0, qy: 0, qz: 0, qw: 1 },
      { id: targetId, catalogItemId: straightCatalogId, partNumber: 'STRAIGHT', revision: 2,
        xMm: 1000, yMm: 2000, zMm: 3000, qx: 0, qy: 0, qz: 0, qw: 1, lengthMm: 1300 },
    ],
    catalogue: [
      { id: unknownCatalogId, originalFilename: 'custom-unregistered.step', sourceSha256: 'a'.repeat(64) },
      { id: straightCatalogId, originalFilename: 'NDX_KL_100-203_F_MED_214.step',
        sourceSha256: '0b0afd99c5be6ea619859897c91e5439f7d8e8c64e61ef44f808d09b54b4599c' },
    ],
    editingId: firstId, route: null, disabled: false, pick, request, onMoved, onBusyChange,
    ...overrides,
  };
  const view = render(<FluentProvider theme={webLightTheme}><ManualSectionPlacement {...props} /></FluentProvider>);
  return { ...view, props, request, pick, onMoved, onBusyChange };
}

async function chooseAnchor() {
  fireEvent.click(screen.getByRole('button', { name: 'Pick moving point' }));
  await waitFor(() => expect(screen.getByLabelText('Point X (mm)')).toBeEnabled());
}

function changePoint(x: string, y: string, z: string) {
  for (const [axis, value] of [['X', x], ['Y', y], ['Z', z]])
    fireEvent.change(screen.getByLabelText(`Point ${axis} (mm)`), { target: { value } });
}

function postBody(request: ReturnType<typeof fixture>['request']) {
  const call = request.mock.calls.find(([path]) => path === '/translate-selection');
  expect(call).toBeDefined();
  return JSON.parse(call![1]!.body as string);
}

afterEach(cleanup);

describe('manual section point placement', () => {
  it('accepts unregistered geometry, restricts source picks and saves the inverse-rotated local anchor in mm', async () => {
    const { pick, request, onMoved, onBusyChange } = fixture();
    await chooseAnchor();
    expect(pick).toHaveBeenCalledWith({ cadInstanceIds: [firstId] });
    expect(screen.getByLabelText('Point X (mm)')).toHaveValue(80);
    expect(screen.getByLabelText('Point Y (mm)')).toHaveValue(210);
    expect(screen.getByLabelText('Point Z (mm)')).toHaveValue(330);
    changePoint('1000', '-2000', '500');
    fireEvent.click(screen.getByRole('button', { name: 'Move and save' }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledOnce());
    const body = postBody(request);
    expect(body.anchor.instanceId).toBe(firstId);
    expect(body.anchor.localPointMm.x).toBeCloseTo(10, 10);
    expect(body.anchor.localPointMm.y).toBeCloseTo(20, 10);
    expect(body.anchor.localPointMm.z).toBeCloseTo(30, 10);
    expect(body.targetPointMm).toEqual({ x: 1000, y: -2000, z: 500 });
    expect(body.instances).toEqual([{ id: firstId, expectedRevision: 3 }]);
    expect(body).not.toHaveProperty('route');
    expect(onBusyChange.mock.calls.map(([busy]) => busy)).toEqual([true, false, true, false]);
  });

  it('moves every member of the selected route with all current revisions', async () => {
    const route: NonNullable<Props['route']> = {
      id: routeId, name: 'BC001', tag: 'BC001', color: '#112233', purpose: 'Power', revision: 9,
      status: 'draft', instanceIds: [firstId, secondId], projectTrayId: null,
    };
    const { pick, request, onMoved } = fixture({ route });
    fireEvent.change(screen.getByLabelText('Move selection'), { target: { value: 'route' } });
    await chooseAnchor();
    expect(pick).toHaveBeenCalledWith({ cadInstanceIds: [firstId, secondId] });
    changePoint('2000', '3000', '4000');
    fireEvent.click(screen.getByRole('button', { name: 'Move and save' }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledOnce());
    expect(postBody(request)).toMatchObject({
      instances: [{ id: firstId, expectedRevision: 3 }, { id: secondId, expectedRevision: 7 }],
      route: { id: routeId, expectedRevision: 9 },
    });
  });

  it('snaps a CAD target to its nearest exact endpoint, including its cut length', async () => {
    const { pick } = fixture();
    await chooseAnchor();
    pick.mockResolvedValueOnce({ point: [0.999, 2.049, 4.295], cadInstanceId: targetId, derivation: 'picked-surface-point' });
    fireEvent.click(screen.getByRole('button', { name: 'Snap to route end' }));
    await waitFor(() => expect(screen.getByLabelText('Point Z (mm)')).toHaveValue(4300));
    expect(screen.getByLabelText('Point X (mm)')).toHaveValue(1000);
    expect(screen.getByLabelText('Point Y (mm)')).toHaveValue(2050);
    expect(pick).toHaveBeenLastCalledWith({ cadInstanceIds: [secondId, targetId], allowSource: true });
    expect(screen.getByRole('status')).toHaveTextContent('Endpoint snapped');
  });

  it('preserves an explicit surface destination without silently snapping it', async () => {
    const { pick } = fixture();
    await chooseAnchor();
    pick.mockResolvedValueOnce({ point: [0.999, 2.049, 4.295], cadInstanceId: targetId, derivation: 'picked-surface-point' });
    fireEvent.click(screen.getByRole('button', { name: 'Pick destination point' }));
    await waitFor(() => expect(screen.getByLabelText('Point X (mm)')).toHaveValue(999));
    expect(screen.getByLabelText('Point Y (mm)')).toHaveValue(2049);
    expect(screen.getByLabelText('Point Z (mm)')).toHaveValue(4295);
    expect(screen.getByRole('status')).toHaveTextContent('Destination point selected');
  });

  it('matches a clicked source object with string endpoint identities and only uses that object', async () => {
    const targets = [
      { objectId: '42', objectRevisionId: 'revision-42', portIndex: 0, pointMm: { x: 1000, y: 2000, z: 3000 }, label: 'BC042 start' },
      { objectId: '42', objectRevisionId: 'revision-42', portIndex: 1, pointMm: { x: 1000, y: 2000, z: 4500 }, label: 'BC042 end' },
      { objectId: '99', objectRevisionId: 'revision-99', portIndex: 0, pointMm: { x: 1001, y: 2001, z: 4499 }, label: 'BC099 start' },
    ];
    const request = vi.fn<Props['request']>().mockResolvedValue(new Response(JSON.stringify({ targets })));
    const { pick } = fixture({ request });
    await screen.findByLabelText('Existing route endpoint');
    await chooseAnchor();
    pick.mockResolvedValueOnce({ point: [1.001, 2.001, 4.499], objectId: 42, derivation: 'picked-surface-point' });
    fireEvent.click(screen.getByRole('button', { name: 'Snap to route end' }));
    await waitFor(() => expect(screen.getByLabelText('Point Z (mm)')).toHaveValue(4500));
    expect(screen.getByLabelText('Point X (mm)')).toHaveValue(1000);
    expect(screen.getByLabelText('Point Y (mm)')).toHaveValue(2000);
  });

  it('keeps manual destination available when a part has no registered endpoints', async () => {
    const { pick, request } = fixture();
    await chooseAnchor();
    pick.mockResolvedValueOnce({ point: [0.5, 0.6, 0.7], cadInstanceId: secondId, derivation: 'picked-surface-point' });
    fireEvent.click(screen.getByRole('button', { name: 'Snap to route end' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('no registered endpoints'));
    expect(screen.getByLabelText('Point X (mm)')).toHaveValue(80);
    expect(request.mock.calls.filter(([path]) => path === '/translate-selection')).toHaveLength(0);
    pick.mockResolvedValueOnce({ point: [0.5, 0.6, 0.7], cadInstanceId: secondId, derivation: 'picked-surface-point' });
    fireEvent.click(screen.getByRole('button', { name: 'Pick destination point' }));
    await waitFor(() => expect(screen.getByLabelText('Point X (mm)')).toHaveValue(500));
  });

  it('refuses a moving point from outside the selected section and handles cancellation without writes', async () => {
    const { pick, request } = fixture();
    pick.mockResolvedValueOnce({ ...sourcePoint, cadInstanceId: secondId });
    fireEvent.click(screen.getByRole('button', { name: 'Pick moving point' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Choose a point on the selected section'));
    expect(screen.getByLabelText('Point X (mm)')).toBeDisabled();
    pick.mockRejectedValueOnce(new Error('Point selection cancelled.'));
    fireEvent.click(screen.getByRole('button', { name: 'Pick moving point' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Point selection cancelled.'));
    expect(request.mock.calls.filter(([path]) => path === '/translate-selection')).toHaveLength(0);
  });

  it('rejects blank and out-of-range target coordinates before saving', async () => {
    const { request } = fixture();
    await chooseAnchor();
    changePoint('', '200', '300');
    fireEvent.click(screen.getByRole('button', { name: 'Move and save' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Enter X, Y and Z'));
    changePoint('1000000001', '200', '300');
    fireEvent.click(screen.getByRole('button', { name: 'Move and save' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('bounded, finite'));
    expect(request.mock.calls.filter(([path]) => path === '/translate-selection')).toHaveLength(0);
  });

  it('ignores a pending pick after the selected section changes', async () => {
    let resolvePick!: (value: Awaited<ReturnType<Props['pick']>>) => void;
    const pending = new Promise<Awaited<ReturnType<Props['pick']>>>(resolve => { resolvePick = resolve; });
    const { pick, props, rerender, request } = fixture();
    pick.mockReturnValueOnce(pending);
    fireEvent.click(screen.getByRole('button', { name: 'Pick moving point' }));
    rerender(<FluentProvider theme={webLightTheme}><ManualSectionPlacement {...props} editingId={secondId} /></FluentProvider>);
    await act(async () => { resolvePick(sourcePoint); await pending; });
    expect(screen.getByLabelText('Point X (mm)')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move and save' })).toBeDisabled();
    expect(request.mock.calls.filter(([path]) => path === '/translate-selection')).toHaveLength(0);
  });
});
