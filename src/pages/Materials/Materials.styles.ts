import { makeStyles, shorthands, tokens } from '@fluentui/react-components';

export const useStyles = makeStyles({
  root: {
    width: '100%',
    maxWidth: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    ...shorthands.padding('2rem', '1.5rem', '4rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  actionsRow: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  hiddenInput: {
    display: 'none'
  },
  tableWrapper: {
    width: '100%',
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeadCell: {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap',
    fontWeight: tokens.fontWeightSemibold
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  numericCell: {
    textAlign: 'right',
    whiteSpace: 'nowrap'
  },
  actionsCell: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    whiteSpace: 'nowrap'
  },
  emptyState: {
    display: 'grid',
    gap: '0.5rem'
  },
  loadCurvesGrid: {
    display: 'grid',
    gap: '1rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 480px))',
    justifyContent: 'center',
    justifyItems: 'center'
  },
  loadCurveCard: {
    display: 'grid',
    gap: '0.75rem',
    alignContent: 'start',
    width: '700px',
    maxWidth: '100%'
  },
  loadCurveChart: {
    width: '600px',
    height: '310px',
    margin: '0 auto'
  },
  loadCurveFooter: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  loadCurvesEmpty: {
    display: 'grid',
    gap: '0.75rem',
    placeItems: 'center',
    minHeight: '160px'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
    marginTop: '1rem'
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem'
  }
});

