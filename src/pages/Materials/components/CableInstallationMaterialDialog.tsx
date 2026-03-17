import type { ChangeEvent, FormEvent } from 'react';
import {
  Body1,
  Button,
  Combobox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Option,
} from '@fluentui/react-components';
import type {
  CableInstallationMaterialFormErrors,
  CableInstallationMaterialFormState,
} from '../CableInstallationMaterials.forms';
import type { ProjectDetailsStyles } from '../../ProjectDetails.styles';

type CableInstallationMaterialDialogProps = {
  styles: ProjectDetailsStyles;
  open: boolean;
  mode: 'create' | 'edit';
  values: CableInstallationMaterialFormState;
  errors: CableInstallationMaterialFormErrors;
  submitting: boolean;
  onFieldChange: (
    field: keyof CableInstallationMaterialFormState,
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  onPurposeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDismiss: () => void;
};

export const CableInstallationMaterialDialog = ({
  styles,
  open,
  mode,
  values,
  errors,
  submitting,
  onFieldChange,
  onPurposeSelect,
  onSubmit,
  onDismiss,
}: CableInstallationMaterialDialogProps) => (
  <Dialog
    open={open}
    onOpenChange={(_, data) => {
      if (!data.open) {
        onDismiss();
      }
    }}
  >
    <DialogSurface>
      <form className={styles.dialogForm} onSubmit={onSubmit}>
        <DialogBody>
          <DialogTitle>
            {mode === 'create'
              ? 'Add cable installation material'
              : 'Edit cable installation material'}
          </DialogTitle>
          <DialogContent>
            <Field
              label="Type"
              required
              validationState={errors.type ? 'error' : undefined}
              validationMessage={errors.type}
            >
              <Input value={values.type} onChange={onFieldChange('type')} required />
            </Field>
            <Field
              label="Purpose"
              validationState={errors.purpose ? 'error' : undefined}
              validationMessage={errors.purpose}
            >
              <Combobox
                placeholder="Select purpose"
                selectedOptions={values.purpose ? [values.purpose] : []}
                value={values.purpose || undefined}
                onOptionSelect={onPurposeSelect}
                freeform={false}
              >
                <Option value="Grounding">Grounding</Option>
                <Option value="Control">Control</Option>
                <Option value="Power">Power</Option>
                <Option value="VFD">VFD</Option>
                <Option value="MV">MV</Option>
              </Combobox>
            </Field>
            <Field
              label="Material"
              validationState={errors.material ? 'error' : undefined}
              validationMessage={errors.material}
            >
              <Input value={values.material} onChange={onFieldChange('material')} />
            </Field>
            <Field
              label="Description"
              validationState={errors.description ? 'error' : undefined}
              validationMessage={errors.description}
            >
              <Input value={values.description} onChange={onFieldChange('description')} />
            </Field>
            <Field
              label="Manufacturer"
              validationState={errors.manufacturer ? 'error' : undefined}
              validationMessage={errors.manufacturer}
            >
              <Input value={values.manufacturer} onChange={onFieldChange('manufacturer')} />
            </Field>
            <Field
              label="Part No."
              validationState={errors.partNo ? 'error' : undefined}
              validationMessage={errors.partNo}
            >
              <Input value={values.partNo} onChange={onFieldChange('partNo')} />
            </Field>
            {errors.general ? <Body1 className={styles.errorText}>{errors.general}</Body1> : null}
          </DialogContent>
          <DialogActions className={styles.dialogActions}>
            <Button type="button" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" appearance="primary" disabled={submitting}>
              {submitting ? 'Saving...' : mode === 'create' ? 'Add' : 'Save'}
            </Button>
          </DialogActions>
        </DialogBody>
      </form>
    </DialogSurface>
  </Dialog>
);
