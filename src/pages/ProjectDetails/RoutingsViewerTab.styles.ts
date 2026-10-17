import { makeStyles, tokens } from '@fluentui/react-components';

export const useRoutingsViewerStyles = makeStyles({
  layout: {
    display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)',
    width: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
    border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium,
    '@media (min-width: 640px) and (max-width: 899px)': { gridTemplateColumns: '280px minmax(0, 1fr)' },
    '@media (max-width: 639px)': { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 45fr) minmax(0, 55fr)' },
  },
  controls: {
    display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', boxSizing: 'border-box',
    minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overflowWrap: 'anywhere',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  sources: { flexShrink: 0, minWidth: 0 },
  field: { minWidth: 0, '& textarea': { minWidth: 0, width: '100%', boxSizing: 'border-box' } },
  actions: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' },
  cablePanel: { display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0, minHeight: 0, flexShrink: 0 },
  cableList: { listStyleType: 'none', padding: 0, margin: 0, minHeight: 0, maxHeight: '20rem', overflowY: 'auto', overflowX: 'hidden' },
  cableRow: { width: '100%', justifyContent: 'flex-start', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: 'left' },
  status: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  host: { minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden', backgroundColor: '#f5f5f5' },
  result: { display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 },
  table: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200, '& th, & td': { textAlign: 'left', verticalAlign: 'top', padding: '0.25rem', overflowWrap: 'anywhere' } },
  details: { '& summary': { cursor: 'pointer' } },
  error: { color: tokens.colorStatusDangerForeground1 },
});
