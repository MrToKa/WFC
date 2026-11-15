import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { describe, expect, it } from 'vitest';
import type { Cable } from '@/api/client';
import { CableRoutingValue, cableRoutingPresentation } from './CableRoutingValue';
import { emptyRoutingControl } from '../../../shared/cableRoutingControl';

const cable = {
  routing: '/AUTO',
  installLength: null,
  pullDate: null,
  connectedFrom: null,
  connectedTo: null,
  tested: null,
  autoCalculatedRouting: '/AUTO',
  autoRoutingStatus: 'calculated',
  routingControl: emptyRoutingControl(),
} as Cable;
describe('shared routing cell presentation', () => {
  it('uses explicit origin and lets warning take priority over manual and execution protection', () => {
    expect(cableRoutingPresentation(cable).tone).toBe('automatic');
    const manual = {
      ...cable,
      routingControl: { ...emptyRoutingControl(), manualProtected: true, manualRouting: '/AUTO' },
    };
    expect(cableRoutingPresentation(manual).tone).toBe('manual');
    const executed = {
      ...manual,
      pullDate: '2026-11-15',
      routingControl: {
        ...manual.routingControl,
        executionLocked: true,
        executionRouting: '/AUTO',
      },
    };
    expect(cableRoutingPresentation(executed).tone).toBe('execution');
    expect(cableRoutingPresentation({ ...executed, autoCalculatedRouting: '/OTHER' }).tone).toBe(
      'warning',
    );
    expect(cableRoutingPresentation({ ...manual, manualRouteLengthStatus: 'stale' }).tone).toBe(
      'warning',
    );
  });
  it('shows the protecting execution fields and the concrete problem on hover', async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <CableRoutingValue
          cable={{
            ...cable,
            pullDate: '2026-11-15',
            tested: '2026-11-16',
            routingControl: {
              ...emptyRoutingControl(),
              executionLocked: true,
              executionRouting: '/AUTO',
            },
            routingDiagnostics: ['BC182 was deleted. The saved route is retained.'],
          }}
        />
      </FluentProvider>,
    );
    fireEvent.pointerEnter(screen.getByLabelText('Routing: /AUTO'));
    await waitFor(() =>
      expect(screen.getByRole('tooltip')).toHaveTextContent('Protection: Pull date, Cable tested'),
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'BC182 was deleted. The saved route is retained.',
    );
  });
  it.each([webLightTheme, webDarkTheme])(
    'is keyboard focusable and discloses both routes and protection on focus in each theme',
    async (theme) => {
      render(
        <FluentProvider theme={theme}>
          <CableRoutingValue
            cable={{
              ...cable,
              routing: '/MANUAL',
              routingControl: {
                ...emptyRoutingControl(),
                manualProtected: true,
                manualRouting: '/MANUAL',
              },
            }}
          />
        </FluentProvider>,
      );
      const cell = screen.getByLabelText('Routing: /MANUAL');
      expect(cell).toHaveAttribute('tabindex', '0');
      expect(cell).toHaveAttribute('data-routing-tone', 'warning');
      fireEvent.focus(cell);
      await waitFor(() =>
        expect(screen.getByRole('tooltip')).toHaveTextContent('Calculated route: /AUTO'),
      );
      expect(screen.getByRole('tooltip')).toHaveTextContent('Manual route: /MANUAL');
    },
  );
});
