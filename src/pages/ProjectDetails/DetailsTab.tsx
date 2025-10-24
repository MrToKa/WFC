import {
  Body1,
  Button,
  Caption1,
  Dropdown,
  Field,
  Input,
  Option
} from '@fluentui/react-components';

import type { MaterialSupport, Project } from '@/api/client';

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
  trayWidthMm: number | null;
  hasWidthConflict: boolean;
  currentDistance: number | null;
  currentSupportType: string | null;
  defaultValue: number | null;
  input: string;
  selectedSupportId: string | null;
  selectedSupportLabel: string;
  selectedSupportMissing: boolean;
  supportOptions: MaterialSupport[];
  supportsLoading: boolean;
  supportsError: string | null;
  error: string | null;
  saving: boolean;
  onInputChange: (value: string) => void;
  onSupportChange: (supportId: string | null) => void;
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
}: DetailsTabProps) => {
  const supportsErrorMessage =
    supportDistanceOverrides.find(
      (override) => override.supportsError
    )?.supportsError ?? null;

  return (
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
              const hasDistanceOverride = override.currentDistance !== null;
              const distanceDisplay = hasDistanceOverride
                ? `${formatNumeric(override.currentDistance)} m`
                : override.defaultValue !== null
                ? `Default (${formatNumeric(override.defaultValue)} m)`
                : 'Not specified';
              const supportDisplay =
                override.currentSupportType ?? 'Not specified';
              const trayWidthDisplay =
                override.trayWidthMm !== null
                  ? `${override.trayWidthMm.toLocaleString()} mm`
                  : 'Not recorded';
              const supportPlaceholder = override.supportsLoading
                ? 'Loading supports...'
                : override.supportOptions.length > 0
                ? 'Select support'
                : override.trayWidthMm !== null && !override.hasWidthConflict
                ? 'No matching supports'
                : 'No supports available';
              const dropdownDisabled =
                override.saving || override.supportsLoading;
              const selectedOption = override.selectedSupportId ?? '';

              return (
                <div key={override.trayType} className={styles.numericField}>
                  <Body1 className={styles.numericFieldLabel}>
                    {override.trayType}
                  </Body1>
                  <Caption1>Current distance</Caption1>
                  <Body1>{distanceDisplay}</Body1>
                  <Caption1>Current support</Caption1>
                  <Body1>
                    {supportDisplay}
                    {override.selectedSupportMissing
                      ? ' (not in catalogue)'
                      : ''}
                  </Body1>
                  <Caption1>Tray width</Caption1>
                  <Body1>
                    {trayWidthDisplay}
                    {override.hasWidthConflict
                      ? ' (multiple widths detected)'
                      : ''}
                  </Body1>
                  {override.supportOptions.length === 0 && !override.supportsLoading ? (
                    <Caption1>
                      {override.trayWidthMm !== null && !override.hasWidthConflict
                        ? 'No supports with matching length were found.'
                        : 'No supports available.'}
                    </Caption1>
                  ) : null}
                  {isAdmin ? (
                    <div className={styles.numericFieldControls}>
                      <Field
                        className={styles.numericFieldInput}
                        label="Override distance [m]"
                        validationState={override.error ? 'error' : undefined}
                        validationMessage={override.error}
                      >
                        <Input
                          value={override.input}
                          onChange={(_, data) =>
                            override.onInputChange(data.value)
                          }
                          disabled={override.saving}
                          inputMode="decimal"
                          type="number"
                          step="0.001"
                          min={0}
                          size="small"
                        />
                      </Field>
                      <Field
                        className={styles.numericFieldInput}
                        label="Select support"
                      >
                        <Dropdown
                          value={override.selectedSupportLabel}
                          placeholder={supportPlaceholder}
                          selectedOptions={[selectedOption]}
                          onOptionSelect={(_, data) => {
                            const optionValue =
                              typeof data.optionValue === 'string'
                                ? data.optionValue
                                : null;
                            override.onSupportChange(
                              optionValue && optionValue !== ''
                                ? optionValue
                                : null
                            );
                          }}
                          disabled={dropdownDisabled}
                        >
                          <Option value="" text="None (use default support)">
                            None (use default support)
                          </Option>
                          {override.selectedSupportId &&
                          override.selectedSupportId !== '' &&
                          !override.supportOptions.some(
                            (support) =>
                              support.id === override.selectedSupportId
                          ) ? (
                            <Option
                              value={override.selectedSupportId}
                              text={override.selectedSupportLabel}
                            >
                              {override.selectedSupportLabel}
                            </Option>
                          ) : null}
                          {override.supportOptions.map((support) => {
                            const label =
                              support.lengthMm !== null
                                ? `${support.type} - ${support.lengthMm.toLocaleString()} mm`
                                : support.type;

                            return (
                              <Option key={support.id} value={support.id} text={label}>
                                {label}
                              </Option>
                            );
                          })}
                        </Dropdown>
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
              Leave the distance empty and clear the support selection to use the defaults.
            </Caption1>
          ) : null}
          {supportsErrorMessage ? (
            <Body1 className={styles.errorText}>{supportsErrorMessage}</Body1>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
