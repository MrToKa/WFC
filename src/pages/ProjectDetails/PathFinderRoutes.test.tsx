import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PathFinderRoutes } from './PathFinderRoutes';
import { ProjectPreparationPanel } from './ProjectPreparationPanel';
import type { usePathFinder } from './hooks/usePathFinder';
vi.mock('./ProjectPreparationPanel', () => ({ ProjectPreparationPanel: vi.fn(({active}:{active:boolean}) => <div>{active ? 'Tray check ready' : 'Tray check paused'}</div>) }));
it('shows only the automatic tray preparation and forwards the active state', () => {
  const pf = {} as ReturnType<typeof usePathFinder>, view = render(<PathFinderRoutes pf={pf} active />);
  expect(screen.getByText('Tray check ready')).toBeVisible(); expect(screen.queryByText('Manual diagnostic capture')).toBeNull();
  expect(ProjectPreparationPanel).toHaveBeenCalledWith({pf,active:true,onBusyChange:undefined},undefined);
  view.rerender(<PathFinderRoutes pf={pf} active={false} />); expect(screen.getByText('Tray check paused')).toBeVisible();
});
