import { makeStyles, shorthands, tokens } from '@fluentui/react-components';

export const useProjectDetailsStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    maxWidth: '80rem',
    width: '100%',
    margin: '0 auto',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  metadata: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
    gap: '0.75rem'
  },
  panel: {
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem')
  },
  tabList: {
    alignSelf: 'flex-start'
  },
  tabPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.75rem'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  tableContainer: {
    width: '100%'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'top',
    wordBreak: 'break-word'
  },
  numericCell: {
    textAlign: 'right'
  },
  actionsCell: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  emptyState: {
    padding: '1rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'center'
  },
  hiddenInput: {
    display: 'none'
  },
  dialogForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  pagination: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap'
  }
});

export type ProjectDetailsStyles = ReturnType<typeof useProjectDetailsStyles>;
