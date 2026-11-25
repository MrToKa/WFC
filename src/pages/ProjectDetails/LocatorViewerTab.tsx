import { useRef, type ComponentProps } from 'react';
import { Body1, Button, Caption1, Spinner, Subtitle2 } from '@fluentui/react-components';
import { ControlPanelOpenButton, ControlPanelPart, useControlPanelDetached } from '@/components/ControlPanelWindow';
import { LocatorPanel } from './LocatorPanel';
import { LocatorLocationAssignments } from './LocatorLocationAssignments';
import { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerHeight } from './hooks/useRoutingsViewerHeight';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';

type Props = Omit<ComponentProps<typeof LocatorPanel>, 'assignmentPanel'> & {
  loadedProjectId: string;
  accountId: string;
  active: boolean;
  secondaryDistanceMeters: number;
  onRoutesChanged: () => void;
};

export function LocatorViewerTab({ loadedProjectId, accountId, active, secondaryDistanceMeters, onRoutesChanged, ...locator }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement>(null);
  const detached = useControlPanelDetached();
  const height = useRoutingsViewerHeight(anchor);
  const styles = useRoutingsViewerStyles();
  const pf = usePathFinder({ projectId: locator.projectId, loadedProjectId, token: locator.token,
    isAdmin: locator.admin, container, automaticStatePolling: false });
  const scope = JSON.stringify([pf.data?.activeModel, pf.preparationViewerGeneration]);
  return <section ref={anchor} aria-label="Locator" hidden={!active && !detached}>
    <div className={styles.layout} style={{ height, ...(detached ? { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' } : {}) }}>
      <ControlPanelPart order={1} hidden={!active}>
        <div className={styles.controls} style={detached ? { overflowY: 'visible' } : undefined}>
          <div className={styles.actions} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Subtitle2 as="h3">Locator</Subtitle2><ControlPanelOpenButton />
          </div>
          <div className={styles.status} role="status">
            {pf.loading || pf.viewerPhase === 'loading' ? <Spinner size="tiny" label={pf.viewerMessage} /> : <Body1>{pf.viewerMessage}</Body1>}
            {pf.modelLabel ? <Caption1>Active model: {pf.modelLabel}</Caption1> : null}
            {pf.viewerPhase === 'error' ? <Button onClick={pf.reloadViewer}>Reload model</Button> : null}
          </div>
          {pf.error ? <Body1 role="alert">{pf.error}</Body1> : null}
          <LocatorPanel {...locator} assignmentPanel={<LocatorLocationAssignments key={scope}
            pf={pf} accountId={accountId} active={active} writable={locator.writable}
            secondaryDistanceMeters={secondaryDistanceMeters} onRoutesChanged={onRoutesChanged} />} />
        </div>
      </ControlPanelPart>
      <div className={styles.host} ref={container} data-testid="routings-model-host" />
    </div>
  </section>;
}
