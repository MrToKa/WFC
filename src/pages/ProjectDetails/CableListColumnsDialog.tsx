import { useState } from 'react';
import {
  Body1,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  CABLE_LIST_COLUMNS,
  DEFAULT_CABLE_LIST_COLUMNS,
  type CableListColumnId,
} from '@/api/cableListPreferences';
import type { useCableListColumns } from './hooks/useCableListColumns';

const useStyles = makeStyles({
  columnsButton: {
    '&:enabled': {
      backgroundColor: '#107c10',
      ...shorthands.borderColor('#107c10'),
      color: '#ffffff',
    },
    '&:enabled:hover': {
      backgroundColor: '#0e700e',
      ...shorthands.borderColor('#0e700e'),
    },
    '&:enabled:active': {
      backgroundColor: '#0b5a0b',
      ...shorthands.borderColor('#0b5a0b'),
    },
  },
  content: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  columns: { display: 'flex', flexDirection: 'column' },
});

type Props = {
  preferences: ReturnType<typeof useCableListColumns>;
  showActions: boolean;
};

export const CableListColumnsDialog = ({ preferences, showActions }: Props) => {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CableListColumnId[]>(DEFAULT_CABLE_LIST_COLUMNS);
  const hasDataColumn = draft.some((column) => column !== 'actions');

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (preferences.saving) return;
        if (data.open) {
          setDraft([...preferences.columns]);
          preferences.clearSaveError();
        }
        setOpen(data.open);
      }}
    >
      <DialogTrigger disableButtonEnhancement>
        <Button className={styles.columnsButton} disabled={!preferences.ready}>
          Columns
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Cable list columns</DialogTitle>
          <DialogContent className={styles.content}>
            <Body1>
              Choose the columns shown in your cable lists. This applies only to your account,
              across all projects.
            </Body1>
            <div className={styles.columns}>
              {CABLE_LIST_COLUMNS.filter(({ id }) => id !== 'actions' || showActions).map(
                ({ id, label }) => (
                  <Checkbox
                    key={id}
                    label={label}
                    checked={draft.includes(id)}
                    disabled={preferences.saving}
                    onChange={(_, data) =>
                      setDraft((current) =>
                        data.checked ? [...current, id] : current.filter((column) => column !== id),
                      )
                    }
                  />
                ),
              )}
            </div>
            <Button
              disabled={preferences.saving}
              onClick={() => setDraft([...DEFAULT_CABLE_LIST_COLUMNS])}
            >
              Show all columns
            </Button>
            {!hasDataColumn ? <Body1 role="alert">Select at least one data column.</Body1> : null}
            {preferences.saveError ? <Body1 role="alert">{preferences.saveError}</Body1> : null}
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button disabled={preferences.saving}>Cancel</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              disabled={preferences.saving || !hasDataColumn}
              onClick={async () => {
                if (await preferences.save(draft)) setOpen(false);
              }}
            >
              {preferences.saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
