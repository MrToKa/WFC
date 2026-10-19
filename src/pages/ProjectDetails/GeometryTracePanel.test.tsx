import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeometryTracePanel } from './GeometryTracePanel';
import { useGeometryTrace } from './hooks/useGeometryTrace';
import { geometryTraceFixture, completedEvidenceFixture } from '@/test/geometryTraceFixtures';
import { preparationIds as ids } from '@/test/preparationFixtures';
import type { usePathFinder } from './hooks/usePathFinder';
vi.mock('./hooks/useGeometryTrace', () => ({ useGeometryTrace: vi.fn() }));
function setup() {
  const fixture = geometryTraceFixture(),
    state = {
      ...fixture,
      enabled: true,
      busy: false,
      unknown: false,
      error: null,
      object: fixture.record,
      evidence: null,
      diagnostics: null,
      refresh: vi.fn(),
      open: vi.fn(),
      objects: vi.fn(),
      inspect: vi.fn(),
      create: vi.fn(),
      retry: vi.fn(),
      readEvidence: vi.fn(),
      readDiagnostics: vi.fn(),
    },
    pf = { data: { activeModel: { modelVersionId: ids.part } } } as ReturnType<
      typeof usePathFinder
    >;
  return { ...fixture, state, pf };
}
beforeEach(() => vi.clearAllMocks());
describe('stacked immutable traceability review', () => {
  it('shows historical measurements and exact declared audit separately, with explicit unavailable identity and frame', () => {
    const { state, pf, manifest } = setup();
    vi.mocked(useGeometryTrace).mockReturnValue(
      state as unknown as ReturnType<typeof useGeometryTrace>,
    );
    render(
      <div style={{ width: 300 }}>
        <GeometryTracePanel
          pf={pf}
          active
          aggregate={{ id: manifest.aggregateId, projection: manifest.projection }}
        />
      </div>,
    );
    const object = screen.getByRole('article', { name: 'Immutable object trace' });
    expect(within(object).queryByRole('table')).toBeNull();
    expect(object).toHaveStyle({ minWidth: '0', wordBreak: 'normal' });
    expect(object.textContent).toContain('C# fitted polyline length: 2.5 m');
    expect(object.textContent).toContain('Declared project length: 2500.000 mm');
    expect(object.textContent).toContain('Common engineering frame: Unverified');
    expect(object.textContent).toContain('Source document: Unavailable');
    expect(screen.getByText(/Historical model ·/)).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Read preparation diagnostics', hidden: true }),
    );
    expect(state.readDiagnostics).toHaveBeenCalledWith(0);
  });
  it('distinguishes observed zero offset from unavailable raw observations and freezes unknown creation', async () => {
    const { state, pf, manifest } = setup(),
      evidence = await completedEvidenceFixture();
    vi.mocked(useGeometryTrace).mockReturnValue({
      ...state,
      evidence,
      unknown: true,
    } as unknown as ReturnType<typeof useGeometryTrace>);
    render(
      <GeometryTracePanel
        pf={pf}
        active
        aggregate={{ id: manifest.aggregateId, projection: manifest.projection }}
      />,
    );
    const observations = screen.getByRole('generic', {
      name: 'Completed coordinate observations',
      hidden: true,
    });
    expect(observations.textContent).toContain('Global offset in display units · Observed');
    expect(observations.textContent).toContain('0, 0, 0');
    expect(observations.textContent).toContain('SDK placement transform · Unavailable');
    expect(
      screen.getByRole('button', { name: 'Create trace for published network' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same trace command' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it('mounts no trace controls without current administrator access', () => {
    const { state, pf } = setup();
    vi.mocked(useGeometryTrace).mockReturnValue({
      ...state,
      enabled: false,
    } as unknown as ReturnType<typeof useGeometryTrace>);
    render(<GeometryTracePanel pf={pf} active aggregate={null} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
