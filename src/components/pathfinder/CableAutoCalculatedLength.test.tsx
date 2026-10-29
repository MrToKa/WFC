import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CableAutoCalculatedLength } from './CableAutoCalculatedLength';
import type { AutoLengthView } from '../../../shared/pathfinderAutoLength';

const successful: AutoLengthView = { autoCalculatedLength: 54, autoLengthStatus: 'calculated',
  autoLengthCalculatedAt: '2026-10-21T12:00:00Z', autoLengthBarrierStatus: 'clear', autoLengthMatchesLatestRequest: true };

describe('read-only Path Finder length', () => {
  it('shows the server calculation without an editable control or implicit approval', () => {
    render(<CableAutoCalculatedLength value={successful} />);
    expect(screen.getByText('54')).toBeVisible(); expect(screen.getByText('Checked Path Finder result. Read-only.')).toBeVisible();
    expect(screen.getByText(successful.autoLengthCalculatedAt!)).toHaveAttribute('datetime', successful.autoLengthCalculatedAt);
    expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('spinbutton')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Routing and Design length follow the separate Save and Review/)).toBeVisible();
  });
  it.each(['pending', 'blocked', 'failed', 'cancelled', 'stale', 'unavailable', 'last-successful'] as const)(
    'keeps the last successful value and explains %s without representing it as a new result', status => {
      render(<CableAutoCalculatedLength value={{ ...successful, autoLengthStatus: status, autoLengthMatchesLatestRequest: false }} />);
      expect(screen.getByText('54')).toBeVisible(); expect(screen.queryByText('Checked Path Finder result. Read-only.')).toBeNull();
      expect(screen.getByText(/Last successful|last successful/)).toBeVisible();
    });
  it('shows no value for a legacy cable with no PF projection rather than inventing an estimate', () => {
    render(<CableAutoCalculatedLength value={{}} />);
    expect(screen.getByText('-')).toBeVisible(); expect(screen.getByText('No checked Path Finder length yet.')).toBeVisible();
  });
  it('rejects a malformed partial or non-finite projection instead of displaying it', () => {
    const page = render(<CableAutoCalculatedLength value={{ autoCalculatedLength: 55 }} />);
    expect(screen.getByText('Checked Path Finder length is unavailable.')).toBeVisible(); expect(screen.queryByText('55')).toBeNull();
    page.rerender(<CableAutoCalculatedLength value={{ ...successful, autoCalculatedLength: Infinity }} />);
    expect(screen.getByText('-')).toBeVisible(); expect(screen.queryByText('∞')).toBeNull();
  });
  it('retains explicit drilling and empty-registry explanations', () => {
    const page = render(<CableAutoCalculatedLength value={{ ...successful, autoLengthBarrierStatus: 'bypassed' }} compact />);
    expect(screen.getByText('Calculated with Drill through the walls enabled.')).toBeVisible();
    page.rerender(<CableAutoCalculatedLength value={{ ...successful, autoLengthBarrierStatus: 'no-barriers-declared' }} compact />);
    expect(screen.getByText('No barriers were declared for this calculation.')).toBeVisible();
  });
});
