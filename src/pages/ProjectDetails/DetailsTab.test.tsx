import { useState, type ComponentProps } from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProjectDetailsStyles } from '../ProjectDetails.styles';
import { DetailsTab } from './DetailsTab';

type DetailsProps = ComponentProps<typeof DetailsTab>;

const fixture: Omit<DetailsProps, 'styles' | 'onTrayTemplateChange'> = {
  project: {
    id: 'project-1',
    projectNumber: 'P-1',
    name: 'Project',
    customer: 'Customer',
    manager: null,
    description: null,
    connectionGap: 1,
    secondaryTrayLength: null,
    supportDistance: null,
    supportWeight: null,
    additionalBendingPercent: 10,
    endConnectionLength: 5,
    trayLoadSafetyFactor: null,
    supportDistanceOverrides: {},
    trayPurposeTemplates: {},
    cableLayout: {
      cableSpacing: null,
      considerBundleSpacingAsFree: null,
      minFreeSpacePercent: null,
      maxFreeSpacePercent: null,
      mv: null,
      power: null,
      vfd: null,
      control: null,
      customBundleRanges: null,
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  formattedDates: null,
  isAdmin: true,
  cableSpacingField: {
    label: 'Cable spacing',
    currentValue: null,
    minFreeSpaceCurrent: null,
    maxFreeSpaceCurrent: null,
    input: '',
    minFreeSpaceInput: '',
    maxFreeSpaceInput: '',
    error: null,
    minFreeSpaceError: null,
    maxFreeSpaceError: null,
    saving: false,
    considerBundleSpacingAsFree: false,
    onInputChange: vi.fn(),
    onMinFreeSpaceChange: vi.fn(),
    onMaxFreeSpaceChange: vi.fn(),
    onSave: vi.fn(async () => {}),
    onToggleConsiderBundleSpacingAsFree: vi.fn(async () => {}),
  },
  cableCategoryCards: [],
  customBundleRanges: {
    formState: { mv: [], power: [], vfd: [], control: [] },
    errors: { mv: null, power: null, vfd: null, control: null },
    saving: false,
    hasChanges: false,
    onAddRange: vi.fn(),
    onRemoveRange: vi.fn(),
    onChangeRange: vi.fn(),
    onSave: vi.fn(async () => {}),
    onReset: vi.fn(),
  },
  numericFields: [],
  supportDistanceOverrides: [],
  trayTemplateRows: [
    {
      purpose: 'power',
      label: 'Power',
      selectedFileId: null,
      selectedFileName: null,
      selectedFileAvailable: true,
    },
    {
      purpose: 'control',
      label: 'Control',
      selectedFileId: null,
      selectedFileName: null,
      selectedFileAvailable: true,
    },
  ],
  trayTemplateOptions: [{ id: 'template-1', label: 'Tray report.docx' }],
  trayTemplateSaving: {},
  trayTemplateErrors: {},
  canEditTrayTemplates: true,
};

const StatefulDetails = ({
  onSave,
  canEdit = true,
}: {
  onSave: DetailsProps['onTrayTemplateChange'];
  canEdit?: boolean;
}) => {
  const styles = useProjectDetailsStyles();
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const save: DetailsProps['onTrayTemplateChange'] = async (purpose, fileId) => {
    setSaving({ [purpose]: true });
    try {
      await onSave(purpose, fileId);
    } finally {
      setSaving({});
    }
  };
  return (
    <FluentProvider theme={webLightTheme}>
      <DetailsTab
        {...fixture}
        styles={styles}
        isAdmin={canEdit}
        canEditTrayTemplates={canEdit}
        trayTemplateSaving={saving}
        onTrayTemplateChange={save}
      />
    </FluentProvider>
  );
};

const NumericDetails = ({ project = fixture.project, isAdmin = true, numericFields = [] }: { project?: DetailsProps['project']; isAdmin?: boolean; numericFields?: DetailsProps['numericFields'] }) => {
  const styles = useProjectDetailsStyles();
  return <FluentProvider theme={webLightTheme}><DetailsTab {...fixture} styles={styles} project={project} isAdmin={isAdmin} numericFields={numericFields} onTrayTemplateChange={vi.fn(async () => {})} /></FluentProvider>;
};

describe('DetailsTab tray report templates', () => {
  it('renders a separate metre gap card with three-decimal input and existing read-only behavior', () => {
    const change = vi.fn(), save = vi.fn(async () => {}), numericFields: DetailsProps['numericFields'] = [{ field: 'connectionGap', label: 'Connection gap', unit: 'm', input: '1', decimals: 3, error: null, saving: false, onInputChange: change, onSave: save }];
    const { rerender } = render(<NumericDetails numericFields={numericFields} />), card = screen.getByText('Connection gap').parentElement!;
    expect(within(card).getByText('1 m')).toBeVisible(); const input = within(card).getByRole('spinbutton', { name: 'Update value [m]' }); expect(input).toHaveAttribute('step', '0.001'); expect(input).toHaveAttribute('min', '0.001'); expect(input).toHaveAttribute('max', '100');
    fireEvent.change(input, { target: { value: '0.25' } }); expect(change).toHaveBeenCalledWith('0.25'); fireEvent.click(within(card).getByRole('button', { name: 'Save' })); expect(save).toHaveBeenCalledOnce();
    rerender(<NumericDetails numericFields={numericFields} isAdmin={false} />); expect(screen.getByText('Connection gap')).toBeVisible(); expect(screen.queryByRole('spinbutton', { name: 'Update value [m]' })).toBeNull();
  });
  it('keeps the tray estimate distinct from the Path Finder formula and shows current project allowances', () => {
    render(<NumericDetails project={{ ...fixture.project, connectionGap: 1, secondaryTrayLength: 4, endConnectionLength: 6, additionalBendingPercent: 10 }} />);
    expect(screen.getByText('Tray-list estimate')).toBeVisible(); expect(screen.getByText('Path Finder design length')).toBeVisible();
    expect(screen.getByText('Auto calculated length [m] = ceil(Total routing length [m] × (1 + Additional % for bending / 100) + For end connection [m])')).toBeVisible();
    expect(screen.getByText('ceil((max(0, Geometric length − flagged From/To approach lengths) + Secondary tray length × number of flagged approaches + For end connection) × (1 + Additional % for bending / 100))')).toBeVisible();
    expect(screen.getByText('Current Path Finder values: SECONDARY 4 m; end connection reserve 6 m; bending allowance 10%.')).toBeVisible(); expect(screen.getByText(/Measured connection gaps are already included in geometric length and are not added again/)).toBeVisible();
  });
  it('keeps the separate model section visible for read-only project access', () => {
    render(<StatefulDetails onSave={vi.fn(async () => {})} canEdit={false} />);
    expect(screen.getByRole('region', { name: '3D model' })).toBeInTheDocument();
  });

  it('preserves numeric field draft and explicit save handlers independently of model selection', () => {
    const change = vi.fn();
    const save = vi.fn(async () => {});
    const traySave = vi.fn(async () => {});
    const NumericDetails = () => {
      const styles = useProjectDetailsStyles();
      return <FluentProvider theme={webLightTheme}><DetailsTab {...fixture} styles={styles} onTrayTemplateChange={traySave} numericFields={[{
        field: 'additionalBendingPercent', label: 'Additional bending', input: '10', decimals: 0,
        error: null, saving: false, onInputChange: change, onSave: save,
      }]} /></FluentProvider>;
    };
    render(<NumericDetails />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Update value' }), { target: { value: '15' } });
    expect(change).toHaveBeenCalledExactlyOnceWith('15');
    const numericCard = screen.getByText('Additional bending').parentElement;
    expect(numericCard).not.toBeNull();
    fireEvent.click(within(numericCard!).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledOnce();
    expect(traySave).not.toHaveBeenCalled();
  });

  it('initially collapses the change tracker and opens it on demand', () => {
    render(<StatefulDetails onSave={vi.fn(async () => {})} />);
    const toggle = screen.getByRole('button', { name: 'Change tracker' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('No recorded changes yet. Future saved changes will appear here.')).toBeVisible();
  });
  it('disables every template selector while one assignment is saving, then enables them again', async () => {
    let finishSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    render(<StatefulDetails onSave={onSave} />);
    const power = screen.getByRole('combobox', { name: 'Tray report template for Power' });
    const control = screen.getByRole('combobox', { name: 'Tray report template for Control' });
    expect(power).toBeEnabled();
    expect(control).toBeEnabled();

    fireEvent.click(power);
    fireEvent.click(await screen.findByRole('option', { name: 'Tray report.docx' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('power', 'template-1');
    expect(power).toBeDisabled();
    expect(control).toBeDisabled();
    expect(screen.getAllByText('Saving...')).toHaveLength(1);

    await act(async () => finishSave());
    await waitFor(() => expect(control).toBeEnabled());
    expect(power).toBeEnabled();
    expect(screen.queryByText('Saving...')).not.toBeInTheDocument();
  });

  it('hides report templates when editing permission is absent', () => {
    const onSave = vi.fn(async () => {});
    render(<StatefulDetails onSave={onSave} canEdit={false} />);
    expect(screen.queryByRole('combobox', { name: 'Tray report template for Power' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Tray report template for Control' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByText('Tray report templates')).not.toBeInTheDocument();
  });
});
