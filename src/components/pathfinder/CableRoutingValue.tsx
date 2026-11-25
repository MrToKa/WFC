import { routingDiagnosticText } from '../../../shared/cableRoutingLabels';
import type { CSSProperties } from 'react';
import { Tooltip, tokens } from '@fluentui/react-components';
import type { Cable } from '@/api/client';
import {
  CABLE_ROUTING_PALETTE,
  cableRoutingTone,
  emptyRoutingControl,
  executionRoutingReasons,
} from '../../../shared/cableRoutingControl';

export function cableRoutingPresentation(cable: Cable) {
  const control = cable.routingControl ?? {
    ...emptyRoutingControl(),
    manualRouting: cable.routing,
    manualProtected: Boolean(cable.routing),
  };
  const automatic = cable.autoCalculatedRouting ?? null;
  const stale =
    ['pending', 'stale', 'invalid'].includes(cable.manualRouteLengthStatus ?? '') ||
    ['stale', 'failed', 'blocked', 'unavailable'].includes(cable.autoRoutingStatus ?? '');
  const tone = cableRoutingTone(
    control,
    automatic,
    stale || Boolean(cable.routingDiagnostics?.length),
    cable.routing,
  );
  const facts = {
    installLength: cable.installLength,
    pullDate: cable.pullDate,
    connectedFrom: cable.connectedFrom,
    connectedTo: cable.connectedTo,
    tested: cable.tested,
  };
  const reasons = executionRoutingReasons(facts, control.executionLocked).map(
    (reason) =>
      ({
        INSTALL_LENGTH_RECORDED: 'Install length',
        PULL_DATE_RECORDED: 'Pull date',
        CONNECTED_FROM_RECORDED: 'Connected From',
        CONNECTED_TO_RECORDED: 'Connected To',
        TESTED_DATE_RECORDED: 'Cable tested',
        EXECUTION_LOCK_RETAINED: 'Execution protection retained',
      })[reason],
  );
  return { tone, control, automatic, reasons, label: CABLE_ROUTING_PALETTE[tone].label };
}

const routingCellStyles = {
  automatic: {
    backgroundColor: tokens.colorPaletteBlueBackground2,
    color: tokens.colorPaletteBlueForeground2,
  },
  manual: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    color: tokens.colorPaletteGreenForeground2,
  },
  execution: {
    backgroundColor: tokens.colorNeutralBackground5,
    color: tokens.colorNeutralForeground1,
  },
  warning: {
    backgroundColor: tokens.colorPaletteDarkOrangeBackground2,
    color: tokens.colorPaletteDarkOrangeForeground2,
  },
} satisfies Record<keyof typeof CABLE_ROUTING_PALETTE, CSSProperties>;

export function routingCellAppearance(cable: Cable): CSSProperties {
  return routingCellStyles[cableRoutingPresentation(cable).tone];
}

export function CableRoutingValue({ cable }: { cable: Cable }) {
  const view = cableRoutingPresentation(cable);
  const content = (
    <div style={{ display: 'grid', gap: 4, maxWidth: 480 }}>
      <strong>{view.label}</strong>
      <span>Used route: {cable.routing || 'Not set'}</span>
      <span>Manual route: {view.control.manualRouting || 'Not set'}</span>
      <span>Calculated route: {view.automatic || 'Not calculated'}</span>
      {cable.autoRoutingStatus ? <span>Automatic result: {cable.autoRoutingStatus}</span> : null}
      {!cable.routing && !view.control.manualProtected && !view.control.executionLocked ? <span>Waiting for a current automatic calculation.</span> : null}
      {view.reasons.length ? <span>Protection: {view.reasons.join(', ')}</span> : null}
      {view.tone === 'warning' ? <span>The routes differ or a result needs checking.</span> : null}
      {cable.manualRouteLengthStatus && cable.manualRouteLengthStatus !== 'not-calculated' ? (
        <span>Manual route length: {cable.manualRouteLengthStatus}</span>
      ) : null}
      {cable.routingDiagnostics?.length ? (
        <span>Details: {cable.routingDiagnostics.map(routingDiagnosticText).join('; ')}</span>
      ) : null}
    </div>
  );
  return (
    <Tooltip content={content} relationship="description" withArrow>
      <span
        tabIndex={0}
        data-routing-tone={view.tone}
        aria-label={`Routing: ${cable.routing || 'Not set'}`}
        style={{
          ...routingCellAppearance(cable),
          display: 'block',
          padding: 4,
          borderRadius: 4,
          overflowWrap: 'anywhere',
        }}
      >
        {cable.routing || '-'}
      </span>
    </Tooltip>
  );
}
