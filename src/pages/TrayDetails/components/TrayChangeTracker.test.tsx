import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Tray } from '@/api/types/tray';
import { TrayChangeTracker } from './TrayChangeTracker';

const tray: Tray = {
  id: 'tray',
  projectId: 'project',
  name: 'T1',
  type: null,
  purpose: null,
  widthMm: null,
  heightMm: null,
  lengthMm: 3000,
  includeGroundingCable: false,
  groundingCableTypeId: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const entry = {
  id: 'first',
  userId: 'actor',
  userName: 'Editor',
  changedAt: '2026-01-01T10:00:00Z',
  changes: ['Tray created.'],
};
const view = (value: Tray) => (
  <FluentProvider theme={webLightTheme}>
    <TrayChangeTracker tray={value} />
  </FluentProvider>
);

describe('tray change tracker', () => {
  it('starts collapsed and explains missing history for existing trays', () => {
    render(view(tray));
    const toggle = screen.getByRole('button', { name: 'Change tracker' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(
      screen.getByText('No recorded changes yet. Future saved changes will appear here.'),
    ).toBeVisible();
  });

  it('shows newest changes first and updates after a save without mutating history', () => {
    const original = { ...tray, changeLog: [entry] };
    const { rerender } = render(view(original));
    fireEvent.click(screen.getByRole('button', { name: 'Change tracker' }));
    const updated = {
      ...tray,
      changeLog: [
        entry,
        {
          ...entry,
          id: 'second',
          changedAt: '2026-01-02T10:00:00Z',
          changes: ['Length [mm]: 3000 → 4000'],
        },
      ],
    };
    rerender(view(updated));
    const rows = within(screen.getByRole('table', { name: 'Change tracker' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Length [mm]: 3000 → 4000');
    expect(rows[1]).toHaveTextContent('Editor');
    expect(rows[1]).toHaveTextContent(new Date('2026-01-02T10:00:00Z').toLocaleString());
    expect(rows[2]).toHaveTextContent('Tray created.');
    expect(updated.changeLog.map((item) => item.id)).toEqual(['first', 'second']);
    rerender(view({ ...tray, id: 'other-tray' }));
    expect(screen.getByRole('button', { name: 'Change tracker' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
