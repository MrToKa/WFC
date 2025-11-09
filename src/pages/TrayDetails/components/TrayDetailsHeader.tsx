import React from 'react';
import { Title3, Body1, Button } from '@fluentui/react-components';
import { Project, Tray } from '../../../api/client';

interface TrayDetailsHeaderProps {
  tray: Tray;
  project: Project | null;
  previousTray: Tray | null;
  nextTray: Tray | null;
  isAdmin: boolean;
  isEditing: boolean;
  isDeleting: boolean;
  canGenerateReport: boolean;
  isGeneratingReport: boolean;
  onNavigateTray: (trayId: string) => void;
  onBack: () => void;
  onGenerateReport: () => void;
  onEdit: () => void;
  onDelete: () => void;
  styles: Record<string, string>;
}

export const TrayDetailsHeader: React.FC<TrayDetailsHeaderProps> = ({
  tray,
  project,
  previousTray,
  nextTray,
  isAdmin,
  isEditing,
  isDeleting,
  canGenerateReport,
  isGeneratingReport,
  onNavigateTray,
  onBack,
  onGenerateReport,
  onEdit,
  onDelete,
  styles
}) => {
  const pageTitle = `Tray - ${tray.name}`;

  return (
    <>
      <div className={styles.header}>
        <Title3>{pageTitle}</Title3>
        {project ? (
          <Body1>
            Project: {project.projectNumber} - {project.name}
          </Body1>
        ) : null}
      </div>

      <div className={styles.actions}>
        <Button
          appearance="secondary"
          onClick={() => previousTray && onNavigateTray(previousTray.id)}
          disabled={!previousTray}
        >
          Previous tray
        </Button>
        <Button
          appearance="secondary"
          onClick={() => nextTray && onNavigateTray(nextTray.id)}
          disabled={!nextTray}
        >
          Next tray
        </Button>
        <Button onClick={onBack}>
          Back to project
        </Button>
        <Button
          appearance="primary"
          onClick={onGenerateReport}
          disabled={!canGenerateReport || isGeneratingReport}
        >
          {isGeneratingReport ? 'Generating...' : 'Generate report'}
        </Button>
        {isAdmin ? (
          <>
            {!isEditing ? (
              <Button appearance="primary" onClick={onEdit}>
                Edit tray
              </Button>
            ) : null}
            <Button
              appearance="secondary"
              onClick={onDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete tray'}
            </Button>
          </>
        ) : null}
      </div>
    </>
  );
};
