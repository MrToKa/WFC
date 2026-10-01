import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrefoilClampControls } from './TrefoilClampControls';

const defaultProps = {
  useTrefoilClamps: true,
  saving: false,
  canEdit: true,
  spacingMm: 600,
  onToggle: vi.fn(),
  onSpacingSave: vi.fn(),
  summaries: ['Vulcan V6: 33–38 mm; 0.44 kg/piece; 2 groups'],
  issues: [],
  groupCount: 2,
  totalCount: 12,
  totalWeightKg: 5.28,
  weightPerMeterKg: 1.76,
  styles: {},
};
type Props = React.ComponentProps<typeof TrefoilClampControls>;
const view = (props: Partial<Props> = {}) => (
  <FluentProvider theme={webLightTheme}>
    <TrefoilClampControls {...defaultProps} {...props} />
  </FluentProvider>
);

describe('Trefoil clamp controls', () => {
  it('uses the requested checkbox label and hides clamp fields when disabled', () => {
    const onToggle = vi.fn();
    render(view({ useTrefoilClamps: false, onToggle }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use Trefoild clamps' }));
    expect(onToggle).toHaveBeenCalledWith(expect.anything(), { checked: true });
    expect(
      screen.queryByRole('spinbutton', { name: 'Clamp spacing [mm]' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Selected clamps' })).not.toBeInTheDocument();
  });

  it('saves a changed valid spacing once on blur and refreshes it from saved props', () => {
    const onSpacingSave = vi.fn();
    const { rerender } = render(view({ onSpacingSave }));
    const input = screen.getByRole('spinbutton', { name: 'Clamp spacing [mm]' });
    fireEvent.change(input, { target: { value: '450.5' } });
    expect(onSpacingSave).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onSpacingSave).toHaveBeenCalledExactlyOnceWith(450.5);
    rerender(view({ onSpacingSave, spacingMm: 450.5 }));
    expect(input).toHaveValue(450.5);
    fireEvent.blur(input);
    expect(onSpacingSave).toHaveBeenCalledTimes(1);
  });

  it.each(['', '0', '-12', '1000001'])('retains invalid spacing %j without saving', (draft) => {
    const onSpacingSave = vi.fn();
    render(view({ onSpacingSave }));
    const input = screen.getByRole('spinbutton', { name: 'Clamp spacing [mm]' });
    fireEvent.change(input, { target: { value: draft } });
    fireEvent.blur(input);
    expect(
      screen.getByText('Enter a spacing greater than 0 and up to 1,000,000 mm.'),
    ).toBeVisible();
    expect(input).toHaveValue(draft === '' ? null : Number(draft));
    expect(onSpacingSave).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '600' } });
    fireEvent.blur(input);
    expect(
      screen.queryByText('Enter a spacing greater than 0 and up to 1,000,000 mm.'),
    ).not.toBeInTheDocument();
    expect(onSpacingSave).not.toHaveBeenCalled();
  });

  it.each([{ canEdit: false }, { saving: true }])('locks changes when %j', (props) => {
    const onToggle = vi.fn();
    const onSpacingSave = vi.fn();
    render(view({ ...props, onToggle, onSpacingSave }));
    const checkbox = screen.getByRole('checkbox', { name: 'Use Trefoild clamps' });
    const input = screen.getByRole('spinbutton', { name: 'Clamp spacing [mm]' });
    expect(checkbox).toBeDisabled();
    expect(input).toBeDisabled();
    fireEvent.click(checkbox);
    fireEvent.change(input, { target: { value: '300' } });
    fireEvent.blur(input);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onSpacingSave).not.toHaveBeenCalled();
  });

  it('shows selected clamp sizes, counts, weights and incomplete-calculation issues', () => {
    render(view({ issues: ['Some cables have no diameter; clamp load is incomplete.'] }));
    expect(screen.getByRole('list', { name: 'Selected clamps' })).toHaveTextContent(
      defaultProps.summaries[0],
    );
    expect(screen.getByText('Trefoil groups: 2')).toBeVisible();
    expect(screen.getByText('Clamp quantity: 12')).toBeVisible();
    expect(screen.getByText('Total clamp weight: 5.280 kg')).toBeVisible();
    expect(screen.getByText('Clamp load: 1.760 kg/m')).toBeVisible();
    expect(
      screen.getByText('Some cables have no diameter; clamp load is incomplete.'),
    ).toBeVisible();
  });

  it('explains the bundle setting when there are no trefoil groups', () => {
    render(
      view({ summaries: [], groupCount: 0, totalCount: 0, totalWeightKg: 0, weightPerMeterKg: 0 }),
    );
    expect(
      screen.getByText(
        'No trefoil groups on this tray. Enable trefoil laying in the bundle settings to use clamps.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('Clamp quantity: 0')).not.toBeInTheDocument();
  });
});
