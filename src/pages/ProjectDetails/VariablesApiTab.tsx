import { useEffect, useMemo, useState } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Input,
  Spinner,
  Subtitle2
} from '@fluentui/react-components';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';
import {
  clearProjectPlaceholders,
  getProjectPlaceholders,
  setProjectPlaceholders
} from '@/utils/projectPlaceholders';
import {
  getCustomVariables,
  setCustomVariables,
  type CustomVariable
} from '@/utils/customVariablesStorage';

export type VariablesApiRow = {
  id: string;
  name: string;
  value: string;
};

export type VariablesApiTable = {
  id: string;
  label: string;
  rows: VariablesApiRow[];
};

export type VariablesApiSection = {
  id: string;
  label: string;
  tables: VariablesApiTable[];
};

type VariablesApiTabProps = {
  styles: ProjectDetailsStyles;
  projectId: string;
  sections: VariablesApiSection[];
  isLoading: boolean;
};

export const VariablesApiTab = ({
  styles,
  projectId,
  sections,
  isLoading
}: VariablesApiTabProps) => {
  const [placeholders, setPlaceholders] = useState<Record<string, string>>(() =>
    getProjectPlaceholders(projectId)
  );
  const [customVariables, setCustomVariablesState] = useState<CustomVariable[]>(
    () => getCustomVariables(projectId)
  );

  useEffect(() => {
    setPlaceholders(getProjectPlaceholders(projectId));
  }, [projectId]);

  useEffect(() => {
    setCustomVariablesState(getCustomVariables(projectId));
  }, [projectId]);

  useEffect(() => {
    if (Object.keys(placeholders).length === 0) {
      clearProjectPlaceholders(projectId);
    } else {
      setProjectPlaceholders(projectId, placeholders);
    }
  }, [placeholders, projectId]);

  useEffect(() => {
    setCustomVariables(projectId, customVariables);
  }, [customVariables, projectId]);

  const handlePlaceholderChange = (rowId: string, value: string) => {
    setPlaceholders((previous) => {
      if (value.trim() === '') {
        if (!(rowId in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[rowId];
        return next;
      }

      if (previous[rowId] === value) {
        return previous;
      }

      return {
        ...previous,
        [rowId]: value
      };
    });
  };

  const handleClearPlaceholders = () => {
    if (Object.keys(placeholders).length === 0) {
      return;
    }
    clearProjectPlaceholders(projectId);
    setPlaceholders({});
  };

  const totalVariables = useMemo(
    () =>
      sections.reduce(
        (sectionTotal, section) =>
          sectionTotal +
          section.tables.reduce(
            (tableTotal, table) => tableTotal + table.rows.length,
            0
          ),
        0
      ) + customVariables.length,
    [sections, customVariables.length]
  );

  const generateCustomVariableId = () =>
    `custom:${Date.now().toString(36)}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const handleAddCustomVariable = () => {
    setCustomVariablesState((previous) => [
      ...previous,
      { id: generateCustomVariableId(), name: '' }
    ]);
  };

  const handleCustomVariableNameChange = (id: string, name: string) => {
    setCustomVariablesState((previous) =>
      previous.map((variable) =>
        variable.id === id ? { ...variable, name } : variable
      )
    );
  };

  const handleDeleteCustomVariable = (id: string) => {
    setCustomVariablesState((previous) =>
      previous.filter((variable) => variable.id !== id)
    );
    setPlaceholders((previous) => {
      if (!(id in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  if (isLoading && sections.length === 0) {
    return (
      <div className={styles.tabPanel}>
        <Spinner label="Preparing variables..." />
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className={styles.tabPanel}>
        <div className={styles.panel}>
          <Body1>No project data available for constructing variables.</Body1>
          <Caption1>
            Ensure cables, trays, files, and templates are loaded to populate
            this view.
          </Caption1>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tabPanel} role="tabpanel" aria-label="Variables API">
      <div className={styles.panel}>
        <div className={styles.variablesIntro}>
          <div className={styles.variablesIntroRow}>
            <div>
              <Subtitle2>Placeholder mapping</Subtitle2>
              <Body1>
                Enter the keyword that should be replaced inside Word templates.
              </Body1>
            </div>
            <div className={styles.variablesActions}>
              <Caption1>{totalVariables} variables detected</Caption1>
              <Button
                size="small"
                appearance="secondary"
                onClick={handleClearPlaceholders}
                disabled={Object.keys(placeholders).length === 0}
              >
                Clear placeholders
              </Button>
            </div>
          </div>
          <Caption1>
            Values are stored per project in your browser only. Use consistent
            tokens such as {'{{PROJECT_NAME}}'} to match the text you will place
            inside the Word template.
          </Caption1>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.id} className={styles.panel}>
          <div className={styles.variablesSectionHeader}>
            <Subtitle2>{section.label}</Subtitle2>
            <Caption1>
              {section.tables.reduce(
                (count, table) => count + table.rows.length,
                0
              )}{' '}
              variables
            </Caption1>
          </div>
          <div className={styles.variablesTables}>
            {section.tables.map((table) => (
              <div key={table.id} className={styles.variablesTableGroup}>
                <Caption1 className={styles.variablesTableTitle}>
                  {table.label}
                </Caption1>
                {table.rows.length === 0 ? (
                  <Body1>No variables found for this table.</Body1>
                ) : (
                  <div className={styles.tableContainer}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.tableHeadCell}>Variable</th>
                          <th className={styles.tableHeadCell}>
                            Word placeholder
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row) => (
                          <tr key={row.id}>
                            <td className={styles.tableCell}>{row.name}</td>
                            <td className={styles.tableCell}>
                              <Input
                                className={styles.variablesInput}
                                appearance="underline"
                                placeholder="e.g. {{PROJECT_NAME}}"
                                value={placeholders[row.id] ?? ''}
                                onChange={(_, data) =>
                                  handlePlaceholderChange(row.id, data.value)
                                }
                                aria-label={`Placeholder for ${row.name}`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className={styles.panel}>
        <div className={styles.variablesSectionHeader}>
          <Subtitle2>Custom variables</Subtitle2>
          <Caption1>{customVariables.length} variables</Caption1>
        </div>
        <div className={styles.customVariablesActions}>
          <Button appearance="primary" onClick={handleAddCustomVariable}>
            Add custom variable
          </Button>
        </div>
        {customVariables.length === 0 ? (
          <Body1 className={styles.emptyState}>
            No custom variables added yet.
          </Body1>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableHeadCell}>Variable</th>
                  <th className={styles.tableHeadCell}>Word placeholder</th>
                  <th className={styles.tableHeadCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {customVariables.map((variable) => (
                  <tr key={variable.id}>
                    <td className={styles.tableCell}>
                      <Input
                        className={styles.variablesInput}
                        appearance="underline"
                        placeholder="Describe the value this placeholder should inject"
                        value={variable.name}
                        onChange={(_, data) =>
                          handleCustomVariableNameChange(variable.id, data.value)
                        }
                        aria-label="Custom variable description"
                      />
                    </td>
                    <td className={styles.tableCell}>
                      <Input
                        className={styles.variablesInput}
                        appearance="underline"
                        placeholder="e.g. {{CUSTOM_TOKEN}}"
                        value={placeholders[variable.id] ?? ''}
                        onChange={(_, data) =>
                          handlePlaceholderChange(variable.id, data.value)
                        }
                        aria-label="Custom variable placeholder"
                      />
                    </td>
                    <td className={styles.tableCell}>
                      <Button
                        appearance="secondary"
                        size="small"
                        onClick={() => handleDeleteCustomVariable(variable.id)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
