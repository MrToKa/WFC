import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
  Textarea,
} from '@fluentui/react-components';
import type {
  MaterialCableInstallationMaterial,
  MaterialTrayInstallationMaterial,
  StandardMaterialAssignment,
  StandardMaterialInput,
  StandardMaterialUnit,
} from '@/api/client';

type StandardMaterialDialogProps = {
  open: boolean;
  assignment: StandardMaterialAssignment | null;
  catalog: Array<MaterialCableInstallationMaterial | MaterialTrayInstallationMaterial>;
  catalogItemLabel?: string;
  ownerMaterialId: string;
  excludeOwnerFromCatalog: boolean;
  saving: boolean;
  onDismiss: () => void;
  onSave: (input: StandardMaterialInput) => Promise<void>;
};

export const StandardMaterialDialog = ({
  open,
  assignment,
  catalog,
  catalogItemLabel = 'Cable Installation Material',
  ownerMaterialId,
  excludeOwnerFromCatalog,
  saving,
  onDismiss,
  onSave,
}: StandardMaterialDialogProps) => {
  const [referencedMaterialId, setReferencedMaterialId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<StandardMaterialUnit>('pcs');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => catalog.filter((item) => !excludeOwnerFromCatalog || item.id !== ownerMaterialId),
    [catalog, excludeOwnerFromCatalog, ownerMaterialId],
  );

  const purposeOptions = useMemo(() => {
    const uniquePurposes = new Map<string, string>();

    for (const item of options) {
      const trimmedPurpose = item.purpose?.trim();
      if (trimmedPurpose) {
        uniquePurposes.set(trimmedPurpose.toLocaleLowerCase(), trimmedPurpose);
      }
    }

    return [...uniquePurposes.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    );
  }, [options]);

  const filteredOptions = useMemo(() => {
    const normalizedPurpose = purpose.toLocaleLowerCase();
    if (!normalizedPurpose) return options;

    return options.filter((item) => item.purpose?.trim().toLocaleLowerCase() === normalizedPurpose);
  }, [options, purpose]);

  useEffect(() => {
    if (!open) return;
    const assignedMaterial = options.find((item) => item.id === assignment?.referencedMaterialId);
    setPurpose(assignedMaterial?.purpose?.trim() ?? '');
    setReferencedMaterialId(assignment?.referencedMaterialId ?? options[0]?.id ?? '');
    setQuantity(assignment ? String(assignment.quantity) : '1');
    setUnit(assignment?.unit ?? 'pcs');
    setRemarks(assignment?.remarks ?? '');
    setError(null);
  }, [assignment, open, options]);

  const handlePurposeChange = (nextPurpose: string): void => {
    setPurpose(nextPurpose);

    const normalizedPurpose = nextPurpose.toLocaleLowerCase();
    const matchingOptions = normalizedPurpose
      ? options.filter((item) => item.purpose?.trim().toLocaleLowerCase() === normalizedPurpose)
      : options;

    if (!matchingOptions.some((item) => item.id === referencedMaterialId)) {
      setReferencedMaterialId(matchingOptions[0]?.id ?? '');
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const numericQuantity = Number(quantity);
    if (!referencedMaterialId) {
      setError(`Select a ${catalogItemLabel}.`);
      return;
    }
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      setError('Quantity must be a finite number greater than zero.');
      return;
    }
    setError(null);
    await onSave({
      referencedMaterialId,
      quantity: numericQuantity,
      unit,
      remarks: remarks.trim() === '' ? null : remarks.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onDismiss()}>
      <DialogSurface aria-label={assignment ? 'Edit Standard Material' : 'Add Standard Material'}>
        <form onSubmit={(event) => void submit(event)}>
          <DialogBody>
            <DialogTitle>
              {assignment ? 'Edit Standard Material' : 'Add Standard Material'}
            </DialogTitle>
            <DialogContent>
              <Field label="Purpose">
                <Select
                  aria-label="Purpose"
                  value={purpose}
                  onChange={(event) => handlePurposeChange(event.target.value)}
                  disabled={saving}
                >
                  <option value="">All purposes</option>
                  {purposeOptions.map((purposeOption) => (
                    <option key={purposeOption.toLocaleLowerCase()} value={purposeOption}>
                      {purposeOption}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={catalogItemLabel} required>
                <Select
                  aria-label={catalogItemLabel}
                  value={referencedMaterialId}
                  onChange={(event) => setReferencedMaterialId(event.target.value)}
                  disabled={saving}
                >
                  <option value="">Select a material</option>
                  {filteredOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.type}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" required>
                <Input
                  aria-label="Quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(_, data) => setQuantity(data.value)}
                  disabled={saving}
                />
              </Field>
              <Field label="Unit" required>
                <Select
                  aria-label="Unit"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value as StandardMaterialUnit)}
                  disabled={saving}
                >
                  <option value="pcs">pcs</option>
                  <option value="meters">meters</option>
                  <option value="pcs/m">pcs/m</option>
                </Select>
              </Field>
              <Field label="Remarks">
                <Textarea
                  aria-label="Remarks"
                  value={remarks}
                  onChange={(_, data) => setRemarks(data.value)}
                  disabled={saving}
                />
              </Field>
              {error ? <div role="alert">{error}</div> : null}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={onDismiss} disabled={saving}>
                Cancel
              </Button>
              <Button appearance="primary" type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
