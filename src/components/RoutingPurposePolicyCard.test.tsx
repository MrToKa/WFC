import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoutingPurposePolicyCard, routingPurposeDisplayLabels } from './RoutingPurposePolicyCard';
vi.mock('@fluentui/react-components', () => ({
  tokens: {}, Spinner: () => null,
  Button: ({ children, appearance: _appearance, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { appearance?: string; size?: string }) => <button {...props}>{children}</button>,
  Checkbox: ({ onChange, checked, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { onChange: (event: React.ChangeEvent<HTMLInputElement>, data: { checked: boolean }) => void }) =>
    <input {...props} type="checkbox" checked={checked} onChange={event => onChange(event, { checked: event.target.checked })} />,
}));
const state = vi.hoisted(() => ({ toggle: vi.fn(), exclude: vi.fn(), reset: vi.fn(), cablePurposes: ['Control', 'Grounding', 'Power', 'VFD'], invalidCablePurposeCount: 2 }));
vi.mock('@/pages/ProjectDetails/hooks/useRoutingPurposePolicy', () => ({ useRoutingPurposePolicy: () => ({
  ...state, rows: ['Synthetic and  Control', 'Synthetic and Control'].map(purposeKey => ({ purposeKey, trayCount: 1, categories: ['LV'], configured: true, blocked: false, dirty: false })),
  snapshot: { catalog: { rowCount: 2, diagnostics: [] }, policy: { routingPolicyRevision: '0' } }, canEdit: true, canSave: false,
}) }));
describe('routing purpose spacing variants', () => {
  it('retains exact distinct keys, stable variant names and visible spacing without merging case', () => {
    const keys = ['Synthetic and Control', 'Synthetic and  Control', 'synthetic and Control'];
    const labels = routingPurposeDisplayLabels(keys);
    expect([...labels.keys()].sort()).toEqual(keys.slice(0, 2).sort());
    expect(labels.get('Synthetic and  Control')).toMatchObject({ variant: 'Spacing variant 1 of 2', exactSpacing: 'Synthetic·and··Control' });
    expect(labels.get('Synthetic and Control')).toMatchObject({ variant: 'Spacing variant 2 of 2', exactSpacing: 'Synthetic·and·Control' });
    expect(routingPurposeDisplayLabels([...keys].reverse())).toEqual(labels);
  });
  it('shows preserved whitespace and disambiguates each control while sending the original purpose key', () => {
    render(<RoutingPurposePolicyCard projectId="synthetic" loadedProjectId="synthetic" token="synthetic" isAdmin />);
    const original = screen.getByText('Synthetic and Control', { exact: true, normalizer: value => value });
    expect(original).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(screen.getByText('Synthetic·and··Control')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Grounding' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Power' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'VFD' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('2 invalid Purpose values are unavailable for routing');
    expect(screen.queryByRole('columnheader', { name: 'MV' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'LV' })).toBeNull();
    expect(screen.getAllByText(/No matching Cable types Purpose: LV/)).toHaveLength(2);
    const checkbox = screen.getByRole('checkbox', { name: 'VFD for Synthetic and Control (Spacing variant 2 of 2)' });
    fireEvent.click(checkbox);
    expect(state.toggle).toHaveBeenCalledWith('Synthetic and Control', 'VFD', true);
    fireEvent.click(screen.getByRole('button', { name: /Exclude .*Spacing variant 1 of 2/ }));
    expect(state.exclude).toHaveBeenCalledWith('Synthetic and  Control');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Synthetic and Control (Spacing variant 2 of 2)' }));
    expect(state.reset).toHaveBeenCalledWith('Synthetic and Control');
  });
});
