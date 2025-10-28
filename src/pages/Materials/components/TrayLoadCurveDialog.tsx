import type { FormEvent } from 'react';
import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Option
} from '@fluentui/react-components';
import type { OptionOnSelectData } from '@fluentui/react-components';
import type { MaterialLoadCurveSummary, MaterialTray } from '@/api/client';

type TrayLoadCurveDialogProps = {
  open: boolean;
  tray: MaterialTray | null;
  loadCurves: MaterialLoadCurveSummary[];
  selection: string;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;
  onSelectionChange: (_event: unknown, data: OptionOnSelectData) => void;
  onReload: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  dialogActionsClassName: string;
};

const formatLoadCurveLabel = (
  curve: MaterialLoadCurveSummary,
  tray: MaterialTray | null
): string => {
  const baseLabel = curve.name;
  const assignedCount = curve.assignedTrayCount;
  const assignedTypes = curve.assignedTrayTypes;
  const trayType = tray ? tray.type : null;
  const includesCurrentTray = Boolean(
    trayType && assignedTypes.some((type) => type === trayType)
  );

  if (assignedCount === 0) {
    return baseLabel;
  }

  if (includesCurrentTray) {
    if (assignedCount === 1) {
      return `${baseLabel} (Current tray)`;
    }
    return `${baseLabel} (Includes current tray, ${assignedCount} trays total)`;
  }

  if (assignedCount === 1) {
    const [onlyTray] = assignedTypes;
    return `${baseLabel} (Used by ${onlyTray})`;
  }

  return `${baseLabel} (Used by ${assignedCount} trays)`;
};

export const TrayLoadCurveDialog = ({
  open,
  tray,
  loadCurves,
  selection,
  isLoading,
  isSubmitting,
  error,
  onSelectionChange,
  onReload,
  onSubmit,
  onClose,
  dialogActionsClassName
}: TrayLoadCurveDialogProps) => {
  const selectedCurve = selection
    ? loadCurves.find((curve) => curve.id === selection)
    : undefined;

  const dropdownValue =
    selection === ''
      ? 'No load curve assigned'
      : selectedCurve
      ? formatLoadCurveLabel(selectedCurve, tray)
      : '';

  const hasLoadCurves = loadCurves.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) {
          onClose();
        }
      }}
    >
      <DialogSurface>
        <form onSubmit={onSubmit}>
          <DialogBody>
            <DialogTitle>
              {tray ? `Assign load curve: ${tray.type}` : 'Assign load curve'}
            </DialogTitle>
            <DialogContent>
              <Field
                label='Load curve'
                validationState={error ? 'error' : undefined}
                validationMessage={error ?? undefined}
              >
                <Dropdown
                  placeholder={isLoading ? 'Loading load curves...' : 'Select load curve'}
                  selectedOptions={selection === '' ? [''] : [selection]}
                  value={dropdownValue}
                  onOptionSelect={onSelectionChange}
                  disabled={isLoading || isSubmitting}
                >
                  <Option value=''>No load curve assigned</Option>
                  {loadCurves.map((curve) => (
                    <Option key={curve.id} value={curve.id}>
                      {formatLoadCurveLabel(curve, tray)}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              {selectedCurve && selectedCurve.assignedTrayCount > 0 ? (
                <Caption1 style={{ marginTop: '0.5rem' }}>
                  {selectedCurve.assignedTrayCount === 1
                    ? `Currently used by ${selectedCurve.assignedTrayTypes[0]}.`
                    : `Currently used by: ${selectedCurve.assignedTrayTypes.join(', ')}.`}
                </Caption1>
              ) : null}
              {!isLoading && !hasLoadCurves ? (
                <Caption1>No load curves available. Create one to assign.</Caption1>
              ) : null}
              {error ? (
                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'center',
                    marginTop: '0.5rem'
                  }}
                >
                  <Caption1>Refresh to try again.</Caption1>
                  <Button
                    type='button'
                    size='small'
                    onClick={onReload}
                    disabled={isLoading}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
            </DialogContent>
            <DialogActions className={dialogActionsClassName}>
              <Button appearance='secondary' type='button' onClick={onClose}>
                Cancel
              </Button>
              <Button appearance='primary' type='submit' disabled={isSubmitting || isLoading}>
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
