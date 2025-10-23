import {
  Body1,
  Button,
  Caption1,
  Field,
  Input
} from '@fluentui/react-components';

import type { Project } from '@/api/client';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import { formatNumeric } from '../ProjectDetails.utils';

type NumericFieldName =
  | 'secondaryTrayLength'
  | 'supportDistance'
  | 'supportWeight';

type NumericFieldConfig = {
  field: NumericFieldName;
  label: string;
  unit?: string;
  input: string;
  error: string | null;
  saving: boolean;
  onInputChange: (value: string) => void;
  onSave: () => Promise<void>;
};

type SupportDistanceOverrideConfig = {
  trayType: string;
  currentValue: number | null;
  defaultValue: number | null;
  input: string;
  error: string | null;
  saving: boolean;
  onInputChange: (value: string) => void;
  onSave: () => Promise<void>;
};

type FormattedDates = {
  created: string;
  updated: string;
} | null;

type DetailsTabProps = {
  styles: ProjectDetailsStyles;
  project: Project;
  formattedDates: FormattedDates;
  isAdmin: boolean;
  numericFields: NumericFieldConfig[];
  supportDistanceOverrides: SupportDistanceOverrideConfig[];
};

export const DetailsTab = ({
  styles,
  project,
  formattedDates,
  isAdmin,
  numericFields,
  supportDistanceOverrides
}: DetailsTabProps) => (
  <div className={styles.tabPanel} role="tabpanel" aria-label="Details">
    {formattedDates ? (
      <div className={styles.metadata}>
        <div className={styles.panel}>
          <Caption1>Created</Caption1>
          <Body1>{formattedDates.created}</Body1>
        </div>
        <div className={styles.panel}>
          <Caption1>Last updated</Caption1>
          <Body1>{formattedDates.updated}</Body1>
        </div>
      </div>
    ) : null}

    <div className={styles.panel}>
      <Caption1>Description</Caption1>
      <Body1>
        {project.description
          ? project.description
          : 'No description provided.'}
      </Body1>
    </div>
    <div className={styles.panel}>
      <Caption1>Project manager</Caption1>
      <Body1>
        {project.manager ? project.manager : 'No manager specified.'}
      </Body1>
    </div>
    <div className={styles.numericFieldsRow}>
      {numericFields.map((field) => {
        const currentValue = project[field.field];
        const isSpecified = currentValue !== null && currentValue !== undefined;
        const formattedValue = isSpecified
          ? `${formatNumeric(currentValue)}${field.unit ? ` ${field.unit}` : ''}`
          : 'Not specified';

        return (
          <div key={field.field} className={styles.numericField}>
            <Body1 className={styles.numericFieldLabel}>{field.label}</Body1>
            <Caption1>Current value</Caption1>
            <Body1>{formattedValue}</Body1>
            {isAdmin ? (
              <div className={styles.numericFieldControls}>
                <Field
                  className={styles.numericFieldInput}
                  label={`Update value${field.unit ? ` [${field.unit}]` : ''}`}
                  validationState={field.error ? 'error' : undefined}
                  validationMessage={field.error}
                >
                  <Input
                    value={field.input}
                    onChange={(_, data) => field.onInputChange(data.value)}
                    disabled={field.saving}
                    inputMode="decimal"
                    type="number"
                    step="0.001"
                    min={0}
                    size="small"
                  />
                </Field>
                <Button
                  appearance="primary"
                  size="small"
                  onClick={() => void field.onSave()}
                  disabled={field.saving}
                >
                  {field.saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
    {supportDistanceOverrides.length > 0 ? (
      <div className={styles.panel}>
        <Caption1>Distance between supports by tray type</Caption1>
        <div className={styles.numericFieldsRow}>
          {supportDistanceOverrides.map((override) => {
            const hasOverride = override.currentValue !== null;
            const displayValue = hasOverride
              ? `${formatNumeric(override.currentValue)} m`
              : override.defaultValue !== null
              ? `Default (${formatNumeric(override.defaultValue)} m)`
              : 'Not specified';

            return (
              <div key={override.trayType} className={styles.numericField}>
                <Body1 className={styles.numericFieldLabel}>
                  {override.trayType}
                </Body1>
                <Caption1>Current value</Caption1>
                <Body1>{displayValue}</Body1>
                {isAdmin ? (
                  <div className={styles.numericFieldControls}>
                    <Field
                      className={styles.numericFieldInput}
                      label="Override value [m]"
                      validationState={override.error ? 'error' : undefined}
                      validationMessage={override.error}
                    >
                      <Input
                        value={override.input}
                        onChange={(_, data) => override.onInputChange(data.value)}
                        disabled={override.saving}
                        inputMode="decimal"
                        type="number"
                        step="0.001"
                        min={0}
                        size="small"
                      />
                    </Field>
                    <Button
                      appearance="primary"
                      size="small"
                      onClick={() => void override.onSave()}
                      disabled={override.saving}
                    >
                      {override.saving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {isAdmin ? (
          <Caption1 className={styles.supportOverridesNote}>
            Leave the override empty to use the default distance between supports.
          </Caption1>
        ) : null}
      </div>
    ) : null}
  </div>
);
