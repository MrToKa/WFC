import { useState, type ComponentProps } from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    secondaryTrayLength: null,
    supportDistance: null,
    supportWeight: null,
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

describe('DetailsTab tray report templates', () => {
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

  it('keeps every selector read-only when editing permission is absent', () => {
    const onSave = vi.fn(async () => {});
    render(<StatefulDetails onSave={onSave} canEdit={false} />);
    const power = screen.getByRole('combobox', { name: 'Tray report template for Power' });
    const control = screen.getByRole('combobox', { name: 'Tray report template for Control' });
    expect(power).toBeDisabled();
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText('Only administrators can change tray report templates.'),
    ).toBeInTheDocument();
  });
});
