import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { PilotPage, ReviewWorkspace } from './GvlStage5';
import { readPilotReport, type PilotReport } from './report';
import { GVL_PILOT_ID } from './pilotId';

const pilot: PilotReport = {
  schemaVersion:'wfc.gvl244.stage5.v1',projectId:GVL_PILOT_ID,scopeStatus:'historical',
  capturedAt:'2026-11-21T00:00:00Z',modelLabel:'Pilot model',
  summary:{locations:3,preserved:1,assigned:1,unresolved:1,cables:2,routed:1,unrouted:1,manualProtected:0,changedTags:0},
  unresolved:[{locationId:'x',name:'Sensor A',status:'ambiguous',reason:'Multiple matches',
    nextAction:'Inspect the two objects',cables:[{tag:'Wire 1',id:'wire',side:'To'}],
    candidates:[{tag:'Pump',objectIds:[456]}],documents:[{source:'P&ID',page:12}]}],
  assigned:[{locationId:'y',name:'Sensor B',status:'assigned',bindingId:'binding',receiptId:'receipt',
    impactId:'impact',jobId:'job',objectIds:[13],evidence:'Verified equipment tag'}],
  routingBlocked:[{id:'wire',tag:'Wire 1',from:'Source A',to:'Sensor A',reason:'Missing location'}],
};
afterEach(()=>{
  cleanup();
  document.querySelector('iframe[data-pilot-test-popup]')?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('GVL244 pilot review',()=>{
  it('shows historical checks and estimated cost separately from the current route counts',()=>{
    const quality = {schemaVersion:'wfc.gvl244.stage6.view.v1' as const, projectId:GVL_PILOT_ID,
      modelVersionId:'983ba43b-9b92-4db7-a0d2-d2cb0df24a7b', capturedAt:pilot.capturedAt,
      pagesTotal:3,pagesAnalyzed:3,locationsChecked:2,verifiedBindings:1,reviewLocations:1,apiAttempts:7,
      estimatedUsd:1.25,ceilingUsd:70,cacheHitRate:null,checksPassed:4,checksTotal:4};
    render(<MemoryRouter><ReviewWorkspace report={{...pilot,quality}}/></MemoryRouter>);
    fireEvent.click(screen.getByText('Проверки и разходи за пилота'));
    expect(screen.getByText('4 от 4')).toBeTruthy();
    expect(screen.getByText('Няма данни')).toBeTruthy();
    expect(screen.getByText(/USD при бюджет 70 USD/)).toBeTruthy();
  });
  it('shows evidence and cable navigation, filters by candidate ID, and exposes recorded assignment lineage',()=>{
    render(<MemoryRouter><ReviewWorkspace report={pilot}/></MemoryRouter>);
    expect(screen.getByText('Исторически отчет')).toBeTruthy();
    fireEvent.click(screen.getByText('Sensor A'));
    expect(screen.getByText('P&ID · стр. 12')).toBeTruthy();
    expect(screen.getByRole('link',{name:'Wire 1'}).getAttribute('href')).toBe(`/projects/${GVL_PILOT_ID}/cables/wire`);
    const query=screen.getByRole('textbox',{name:'Търсене в раздела'});
    fireEvent.change(query,{target:{value:'456'}});
    expect(screen.getByText('Sensor A')).toBeTruthy();
    fireEvent.change(query,{target:{value:'not in pilot'}});
    expect(screen.queryByText('Sensor A')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Кабели за преглед'}));
    expect(screen.getByText('Missing location')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'История на присвояванията'}));
    fireEvent.click(screen.getByText('Sensor B'));
    expect(screen.getByText('receipt')).toBeTruthy();
  });
  it('requests only the selected project and refuses a different project payload', async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({...pilot,projectId:'other'}),{status:200}));
    vi.stubGlobal('fetch',fetcher);
    const signal=new AbortController().signal;
    await expect(readPilotReport(GVL_PILOT_ID,'test-token',signal)).rejects.toThrow('избрания проект');
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/api/projects/${GVL_PILOT_ID}/gvl-stage5/report`),
      {signal,cache:'no-store',headers:{Authorization:'Bearer test-token'}});
  });

  it('downloads all report sections from the detached panel even when the location list is filtered', async () => {
    const locations = Array.from({ length: 26 }, (_, index) => ({
      ...pilot.unresolved[0],
      locationId: `location-${index}`,
      name: index === 25 ? '=1+1' : `Sensor ${index}`,
    }));
    const report = {
      ...pilot,
      unresolved: locations,
      summary: { ...pilot.summary, locations: 28, unresolved: 26 },
      audit: [{ ...pilot.assigned[0], name: 'Audit entry' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(report))));
    const popup = document.createElement('iframe');
    popup.dataset.pilotTestPopup = '';
    document.body.append(popup);
    const popupDocument = popup.contentDocument!;
    const anchorPrototype = Object.getPrototypeOf(popupDocument.createElement('a')) as HTMLAnchorElement;
    const click = vi.spyOn(anchorPrototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:pilot-export');
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = vi.fn();
    });

    const root = popupDocument.createElement('div');
    popupDocument.body.append(root);
    render(<MemoryRouter><PilotPage projectId={GVL_PILOT_ID} token="test-token" /></MemoryRouter>, {
      container: root,
    });
    const panel = within(root);
    const download = panel.getByRole('button', { name: 'Експорт в Excel' }) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    const query = await panel.findByRole('textbox', { name: 'Търсене в раздела' });
    fireEvent.change(query, { target: { value: 'Sensor 0' } });
    expect(panel.getByRole('status').textContent).toBe('1–1 от 1');
    fireEvent.click(download);
    await waitFor(() => expect(click).toHaveBeenCalledOnce(), { timeout: 3000 });
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.ownerDocument).toBe(popupDocument);
    expect(anchor.download).toBe('GVL244-pilot-report-2026-11-21T00-00-00Z.xlsx');
    expect(anchor.isConnected).toBe(false);

    const blob = createObjectURL.mock.calls[0][0];
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    const workbook = XLSX.read(buffer, { type: 'array' });
    expect(workbook.SheetNames).toEqual([
      'Обобщение', 'Проверки и разходи', 'Локации за преглед', 'Кабели за преглед', 'История на присвояванията',
    ]);
    expect(workbook.Sheets['Обобщение'].B10).toMatchObject({ t: 'n', v: 26 });
    expect(workbook.Sheets['Локации за преглед'].A27).toMatchObject({ t: 's', v: '=1+1' });
    expect(workbook.Sheets['Локации за преглед'].A27.f).toBeUndefined();
    expect(workbook.Sheets['Кабели за преглед'].C2.v).toBe('Sensor A');
    expect(workbook.Sheets['История на присвояванията'].A2.v).toBe('Audit entry');
  });
});
