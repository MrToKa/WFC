import { useRef } from 'react';
import { Body1, Button, Caption1, Spinner, Subtitle2 } from '@fluentui/react-components';
import { useRoutingsViewer } from './hooks/useRoutingsViewer';
import { useRoutingsViewerHeight } from './hooks/useRoutingsViewerHeight';
import { CadComponentsPanel } from './CadComponentsPanel';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';

type Props = { projectId: string | null; loadedProjectId: string | null; token: string | null; canDrawTrays?: boolean; onTraysChanged?: () => Promise<void> };

export function RoutingsViewerTab({ projectId, loadedProjectId, token, canDrawTrays = false, onTraysChanged }: Props) {
  const styles = useRoutingsViewerStyles();
  const anchor = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const drawingEnabled = import.meta.env.VITE_CAD_DESIGN_ENABLED !== 'false' && canDrawTrays;
  const height = useRoutingsViewerHeight(anchor);
  const viewer = useRoutingsViewer({ projectId, loadedProjectId, token, container });
  const loading = viewer.phase === 'metadata' || viewer.phase === 'loading';
  const retryable = !loading && viewer.phase !== 'ready' && viewer.phase !== 'login-required';
  return <section ref={anchor} aria-label="Routings builder" data-testid="routings-viewer-tab">
    <div className={styles.layout} style={{ height }} data-testid="routings-layout">
      <div className={styles.controls}>
        <Subtitle2 as="h3">Draw trays</Subtitle2>
        <div className={styles.status} aria-live="polite" aria-atomic="true" data-testid="routings-viewer-status" data-phase={viewer.phase}>
          {loading ? <Spinner size="tiny" label={viewer.message} /> : <Body1>{viewer.message}</Body1>}
          {viewer.model ? <Caption1>Active model: {viewer.model.label}</Caption1> : null}
          {retryable ? <Button onClick={viewer.retry}>Retry</Button> : null}
        </div>
        {drawingEnabled ? <CadComponentsPanel key={JSON.stringify([projectId, token])}
          projectId={projectId} token={token} modelVersionId={viewer.model?.id ?? null}
          ready={viewer.phase === 'ready'} onPick={viewer.pickCadAnchor} onShow={viewer.showCadComponent}
          onMove={viewer.moveCadComponent} onFocus={viewer.focusCadComponent} onRemove={viewer.removeCadComponent}
          onColor={viewer.setCadComponentColor} onProperties={viewer.setCadComponentProperties} onTraysChanged={onTraysChanged} />
          : <Body1>{canDrawTrays ? 'Tray drawing is disabled.' : 'You do not have permission to draw trays in this project.'}</Body1>}
      </div>
      <div className={styles.host} ref={container} data-testid="routings-model-host" />
    </div>
  </section>;
}
