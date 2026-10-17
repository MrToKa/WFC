import { makeStyles, tokens } from '@fluentui/react-components';

export const useCableInformationPanelStyles = makeStyles({
  panel: {
    position: 'fixed', zIndex: 10000, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS,
    boxSizing: 'border-box', minWidth: 0, overflowY: 'auto', overflowX: 'hidden', padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow16,
    pointerEvents: 'auto', overscrollBehavior: 'contain',
  },
  heading: { margin: 0, overflowWrap: 'anywhere', fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS, flexShrink: 0 },
  field: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, minWidth: 0, flexShrink: 0 },
  label: { fontWeight: tokens.fontWeightSemibold },
  value: {
    width: '100%', boxSizing: 'border-box', minWidth: 0, minHeight: '3rem', maxHeight: '10rem', padding: tokens.spacingHorizontalS,
    resize: 'vertical', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'auto', userSelect: 'text',
    color: tokens.colorNeutralForeground1, backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusSmall, font: 'inherit',
  },
  note: { margin: 0, fontSize: tokens.fontSizeBase200, overflowWrap: 'anywhere', flexShrink: 0 },
  manual: { minWidth: 0, flexShrink: 0 },
});
