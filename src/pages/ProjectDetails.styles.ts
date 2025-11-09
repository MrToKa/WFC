import { makeStyles, shorthands, tokens } from '@fluentui/react-components';

export const useProjectDetailsStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    maxWidth: '100%',
    width: '100%',
    margin: '0 auto',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  headerRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem'
  },
  headerActions: {
    display: 'flex',
    flexWrap: 'wrap',
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
  numericFieldsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  numericField: {
    flex: '1 1 14rem',
    maxWidth: '18rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('0.75rem'),
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  numericFieldLabel: {
    fontWeight: tokens.fontWeightSemibold
  },
  numericFieldControls: {
    display: 'flex',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: '0.5rem'
  },
  numericFieldInput: {
    flex: '1 1 auto'
  },
  supportOverridesNote: {
    marginTop: '0.5rem',
    color: tokens.colorNeutralForeground2
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.75rem'
  },
  filtersRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    alignItems: 'center'
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
    verticalAlign: 'middle',
    wordBreak: 'break-word'
  },
  lowFreeSpace: {
    color: tokens.colorStatusDangerForeground1,
    fontWeight: tokens.fontWeightSemibold
  },
  highFreeSpace: {
    color: tokens.colorStatusWarningForeground1,
    fontWeight: tokens.fontWeightSemibold
  },
  tableSortButton: {
    padding: 0,
    minWidth: 'auto',
    height: 'auto',
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold
  },
  sortIndicator: {
    marginLeft: '0.25rem'
  },
  numericCell: {
    textAlign: 'right'
  },
  actionsCell: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start'
  },
  emptyState: {
    padding: '1rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'center'
  },
  replaceDialogSurface: {
    width: 'min(90vw, 32rem)'
  },
  versionsDialogSurface: {
    width: 'min(95vw, 80rem)',
    maxWidth: '80rem'
  },
  versionsDialogContent: {
    overflowX: 'auto',
    maxHeight: '70vh'
  },
  versionsDialogTable: {
    width: '100%',
    minWidth: '56rem',
    borderCollapse: 'collapse'
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
  },
  variablesIntro: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  variablesIntroRow: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: '0.75rem',
    alignItems: 'flex-start'
  },
  variablesActions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '0.25rem'
  },
  variablesSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  variablesTables: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  variablesTableGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  variablesTableTitle: {
    fontWeight: tokens.fontWeightSemibold
  },
  variablesValue: {
    display: 'inline-block',
    maxWidth: '100%',
    fontFamily: `'Consolas', 'SFMono-Regular', 'Source Code Pro', monospace`,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusSmall,
    ...shorthands.padding('0.125rem', '0.375rem'),
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  variablesInput: {
    width: '100%'
  },
  customVariablesActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginBottom: '0.75rem'
  }
});

export type ProjectDetailsStyles = ReturnType<typeof useProjectDetailsStyles>;
