import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildTrayPlaceholderValues,
  replaceDocxPlaceholders,
  type TrayPlaceholderContext,
} from './trayReportUtils';
import { TRAY_REPORT_PLACEHOLDERS, TRAY_REPORT_VARIABLES } from './trayReportVariables';
import { evaluateLoadCurve } from './loadAssessment';

const createContext = (): TrayPlaceholderContext => ({
  project: {
    projectNumber: 'P-100',
    name: 'LV distribution',
    customer: 'Example customer',
    manager: 'Engineer',
    description: '',
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
    supportDistance: 2,
    supportWeight: 2,
    trayLoadSafetyFactor: 20,
  } as TrayPlaceholderContext['project'],
  trays: [],
  tray: {
    name: 'LV-01',
    type: 'KL 100.603 F',
    purpose: 'LV',
    widthMm: 600,
    heightMm: 100,
    lengthMm: 10000,
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
  } as TrayPlaceholderContext['tray'],
  trayCables: [
    {
      cableId: 1,
      tag: 'LV-C001',
      typeName: 'Power cable',
      purpose: 'LV',
      diameterMm: 25,
      weightKgPerM: 15,
    },
  ] as TrayPlaceholderContext['trayCables'],
  projectCableTypes: [],
  projectCables: [],
  projectFiles: [],
  trayTemplatePurposeCount: 1,
  trayFreeSpacePercent: 75,
  trayOccupiedWidthMm: 150,
  includeGroundingCable: false,
  groundingCableTypeName: null,
  supportCalculations: {
    lengthMeters: 10,
    distanceMeters: 2,
    supportsCount: 6,
    weightPerPieceKg: 2,
    totalWeightKg: 12,
    weightPerMeterKg: 1.2,
  },
  supportTypeDisplay: 'Wall bracket',
  supportLengthMm: 650,
  trayWeightLoadPerMeterKg: 6.2,
  trayWeightPerMeterKg: 5,
  trayTotalOwnWeightKg: 62,
  cablesWeightLoadPerMeterKg: 15,
  cablesTotalWeightKg: 150,
  totalWeightLoadPerMeterKg: 21.2,
  totalWeightKg: 212,
  groundingCableWeightKgPerM: null,
  projectCableSpacingMm: 5,
  considerBundleSpacingAsFree: false,
  minFreeSpacePercent: 20,
  maxFreeSpacePercent: 80,
  safetyFactorPercent: 20,
  safetyFactorStatusMessage: null,
  chartSpanMeters: 2,
  safetyAdjustedLoadKnPerM: 0.2353596,
  chartEvaluation: evaluateLoadCurve(
    'curve',
    [
      { spanM: 1, loadKnPerM: 1 },
      { spanM: 3, loadKnPerM: 0.5 },
    ],
    2,
    0.2353596,
    1.2,
    null,
  ),
  selectedLoadCurveName: 'Example manufacturer curve',
  numberFormatter: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }),
  percentageFormatter: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }),
  dateTimeFormatter: new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Kiev',
  }),
  loadCurveImageFileName: 'curve.png',
  bundlesImageFileName: 'layout.png',
  materialTrayMetadata: {
    manufacturer: 'Niedax',
    heightMm: 100,
    widthMm: 600,
    weightKgPerM: 5,
    rungHeightMm: 15,
    imageTemplateId: 'image',
    imageTemplateFileName: 'tray.jpg',
    imageTemplateContentType: 'image/jpeg',
  },
  currentUserDisplay: 'Example engineer',
});
const blobBytes = (blob: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
const xmlOf = async (blob: Blob) =>
  (await JSZip.loadAsync(await blobBytes(blob))).file('word/document.xml')!.async('string');
const inputBlob = async (xml: string) => {
  const zip = new JSZip();
  zip.file('word/document.xml', xml);
  return new Blob([Uint8Array.from(await zip.generateAsync({ type: 'uint8array' }))]);
};
const paragraphXml = (text: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text}</w:body></w:document>`;

describe('tray report Variables API', () => {
  it('provides every new variable and gives the correct calculation and reserve', () => {
    const bundle = buildTrayPlaceholderValues(createContext());
    for (const variable of TRAY_REPORT_VARIABLES) expect(bundle.values[variable.id]).toBeDefined();
    expect(bundle.values['tray-details:span-load-formula']).toContain(
      '(15 + 5) x 9.80665 / 1000 = 0.196133',
    );
    expect(bundle.values['tray-details:design-load-formula']).toContain('0.23536 kN/m');
    expect(bundle.values['tray-details:allowable-load-formula']).toContain('= 0.75 kN/m');
    expect(bundle.values['tray-details:load-utilization']).toBe('31.38 %');
    expect(bundle.values['tray-details:load-reserve']).toBe('0.51464 kN/m');
    expect(bundle.values['tray-details:load-verification']).toMatch(/^PASS/);
  });
  it('shows every routed cable mass and adds the optional grounding conductor once', () => {
    const context = createContext();
    context.trayCables = [
      { ...context.trayCables[0], cableId: 2, weightKgPerM: 2 },
      { ...context.trayCables[0], cableId: 1, weightKgPerM: 1 },
      { ...context.trayCables[0], cableId: 3, weightKgPerM: 0.5, purpose: 'Grounding' },
    ];
    context.includeGroundingCable = true;
    context.groundingCableWeightKgPerM = 0.5;
    context.cablesWeightLoadPerMeterKg = 4;
    expect(
      buildTrayPlaceholderValues(context).values['tray-details:cables-weight-sum-formula'],
    ).toBe('1 + 2 + 0.5 + 0.5 = 4 kg/m');
    context.cablesWeightLoadPerMeterKg = null;
    expect(
      buildTrayPlaceholderValues(context).values['tray-details:cables-weight-sum-formula'],
    ).toBe('*****');
  });
  it('keeps routed grounding mass in the report when the optional conductor is disabled', () => {
    const context = createContext();
    const grounding = {
      ...context.trayCables[0],
      cableId: 642,
      tag: '=H1=KF1=MAA1=XBC1=WEB1',
      typeName: 'RZ1-K GREEN/YELLOW 0.6/1 kV 1x185mm²',
      weightKgPerM: 2,
      purpose: 'Grounding',
    };
    context.trayCables.push(grounding);
    context.includeGroundingCable = false;
    context.cablesWeightLoadPerMeterKg = 17;
    const bundle = buildTrayPlaceholderValues(context);
    expect(bundle.values['tray-details:cables-weight-sum-formula']).toBe('15 + 2 = 17 kg/m');
    expect(bundle.values['tray-details:cables-weight-load-per-meter']).toBe(
      'Sum of 2 routed cable weights = 17 kg/m',
    );
    expect(bundle.tables['tray-details:cables-table'].rows[1]).toContain(grounding.tag);
  });
  it('includes clamp mass once in the component sum and carries the combined load through totals', () => {
    const context = createContext();
    context.trayCables = [
      { ...context.trayCables[0], cableId: 2, weightKgPerM: 2 },
      { ...context.trayCables[0], cableId: 1, weightKgPerM: 1 },
      { ...context.trayCables[0], cableId: 3, weightKgPerM: 0.5, purpose: 'Grounding' },
    ];
    context.includeGroundingCable = true;
    context.groundingCableWeightKgPerM = 0.5;
    context.trefoilClampsWeightKgPerM = 0.25;
    context.cablesWeightLoadPerMeterKg = 4.25;
    context.cablesTotalWeightKg = 42.5;
    context.totalWeightLoadPerMeterKg = 10.45;
    context.totalWeightKg = 104.5;
    const values = buildTrayPlaceholderValues(context).values;
    expect(values['tray-details:cables-weight-sum-formula']).toBe('1 + 2 + 0.5 + 0.5 + 0.25 = 4.25 kg/m');
    expect(values['tray-details:cables-weight-load-per-meter']).toBe(
      'Sum of 3 routed cable weights plus grounding cable plus trefoil clamps = 4.25 kg/m',
    );
    expect(values['tray-details:cables-total-weight']).toBe('4.25 * 10 = 42.5 kg');
    expect(values['tray-details:total-weight-load-per-meter']).toBe('6.2 + 4.25 = 10.45 kg/m');
    expect(values['tray-details:total-weight']).toBe('62 + 42.5 = 104.5 kg');
    expect(values['tray-details:span-load-formula']).toBe(
      '(4.25 + 5) x 9.80665 / 1000 = 0.090712 kN/m',
    );
  });
  it('preserves the original component formula when clamp mass is zero or omitted', () => {
    const context = createContext();
    const omitted = buildTrayPlaceholderValues(context).values;
    context.trefoilClampsWeightKgPerM = 0;
    const disabled = buildTrayPlaceholderValues(context).values;
    expect(disabled['tray-details:cables-weight-sum-formula']).toBe('15 = 15 kg/m');
    expect(disabled['tray-details:cables-weight-load-per-meter']).toBe(
      'Sum of 1 routed cable weights = 15 kg/m',
    );
    expect(disabled['tray-details:cables-weight-sum-formula']).toBe(
      omitted['tray-details:cables-weight-sum-formula'],
    );
    expect(disabled['tray-details:cables-weight-load-per-meter']).toBe(
      omitted['tray-details:cables-weight-load-per-meter'],
    );
  });
  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'does not publish a partial component sum when clamp mass is %s',
    (trefoilClampsWeightKgPerM) => {
      const values = buildTrayPlaceholderValues({
        ...createContext(),
        trefoilClampsWeightKgPerM,
      }).values;
      expect(values['tray-details:cables-weight-sum-formula']).toBe('*****');
      expect(values['tray-details:cables-weight-load-per-meter']).toBe('*****');
    },
  );
  it('exports the occupied-width calculation from the actual Tray details layout', () => {
    const context = createContext();
    context.occupiedWidthFormula = '140 + 10 = 150 mm';
    expect(buildTrayPlaceholderValues(context).values['tray-details:occupied-width-formula']).toBe(
      '140 + 10 = 150 mm',
    );
  });
  it('shows the zero clamp and fails a layout that exceeds the tray width', () => {
    const context = createContext();
    context.trayOccupiedWidthMm = 650;
    context.trayFreeSpacePercent = 0;
    context.minFreeSpacePercent = null;
    context.maxFreeSpacePercent = null;
    const values = buildTrayPlaceholderValues(context).values;
    expect(values['tray-details:free-space']).toBe('max(0, ((600 - 650) / 600) * 100) = 0 %');
    expect(values['tray-details:free-space-verification']).toMatch(/^FAIL/);
  });
  it('reports an overload with a negative reserve', () => {
    const context = createContext();
    context.safetyAdjustedLoadKnPerM = 0.9;
    context.chartEvaluation = evaluateLoadCurve(
      'curve',
      [
        { spanM: 1, loadKnPerM: 1 },
        { spanM: 3, loadKnPerM: 0.5 },
      ],
      2,
      0.9,
      1.2,
      null,
    );
    const values = buildTrayPlaceholderValues(context).values;
    expect(values['tray-details:load-verification']).toMatch(/^FAIL/);
    expect(values['tray-details:load-reserve']).toBe('-0.15 kN/m');
  });
  it('does not report PASS or capacity utilization outside the curve range', () => {
    const context = createContext();
    context.chartSpanMeters = 4;
    context.chartEvaluation = evaluateLoadCurve(
      'curve',
      [
        { spanM: 1, loadKnPerM: 1 },
        { spanM: 3, loadKnPerM: 0.5 },
      ],
      4,
      0.2,
      1.2,
      null,
    );
    const values = buildTrayPlaceholderValues(context).values;
    expect(values['tray-details:load-verification']).toMatch(/^NOT VERIFIED/);
    expect(values['tray-details:load-utilization']).toBe('*****');
  });
  it('matches the support counting rule rather than equating L/s to the count', () => {
    const context = createContext();
    context.supportCalculations = {
      ...context.supportCalculations,
      lengthMeters: 4.5,
      supportsCount: 4,
    };
    const values = buildTrayPlaceholderValues(context).values;
    expect(values['tray-details:supports-count']).toBe(
      'floor(4.5 / 2) = 2; remainder = 0.5 m; N = max(2, 2 + 1) + 1 = 4',
    );
  });
  it('uses the bundle occupied width instead of assuming cables lie in one row', () => {
    expect(buildTrayPlaceholderValues(createContext()).values['tray-details:free-space']).toBe(
      '((600 - 150) / 600) * 100 = 75 %',
    );
  });
});

describe('Word export', () => {
  it('preserves the reference calculation order and places all conclusions before the final picture', async () => {
    const zip = await JSZip.loadAsync(readFileSync('Template files/ReportMacroTemplate_LV.docx'));
    const xml = await zip.file('word/document.xml')!.async('string');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const text = Array.from(document.getElementsByTagNameNS(ns, 'p'))
      .map((p) => p.textContent ?? '')
      .join('\n');
    const headings = Array.from(document.getElementsByTagNameNS(ns, 'p'))
      .filter((p) =>
        /^Heading/.test(p.getElementsByTagNameNS(ns, 'pStyle')[0]?.getAttribute('w:val') ?? ''),
      )
      .map((p) => p.textContent ?? '');
    const titles = [
      'Cable tray dimensions',
      'Support dimensions',
      'Cables laying on the tray',
      'Weight calculations',
      'Supports weight calculations',
      'Tray own weight calculations',
      'Cables on tray weight calculations',
      'Total weight',
      'Tray loading calculations',
      'Free space calculations',
      'Space occupied by cables',
      'Cable tray free space',
      'Assessment results',
      'Cable laying concept',
    ];
    for (let index = 1; index < titles.length; index += 1)
      expect(headings.indexOf(titles[index])).toBeGreaterThan(headings.indexOf(titles[index - 1]));
    const assessment = text.lastIndexOf('Assessment results');
    const finalPage = text.indexOf('Cable laying concept');
    for (const token of [
      '{{LOADVERIFICATION}}',
      '{{FREEWIDTHVERIFICATION}}',
      '{{LOADUTILIZATIONFORMULA}}',
      '{{LOADRESERVEFORMULA}}',
    ]) {
      expect(text.indexOf(token)).toBeGreaterThan(assessment);
      expect(text.indexOf(token)).toBeLessThan(finalPage);
      expect(text.split(token)).toHaveLength(2);
    }
    const finalHeading = Array.from(document.getElementsByTagNameNS(ns, 'p')).find(
      (p) => p.textContent === 'Cable laying concept',
    )!;
    expect(finalHeading.getElementsByTagNameNS(ns, 'pageBreakBefore')).toHaveLength(1);
  });

  it('replaces split Word runs, preserves surrounding formatting, and escapes XML', async () => {
    const input = await inputBlob(
      paragraphXml(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Label </w:t></w:r><w:r><w:t>{{TRAY</w:t></w:r><w:r><w:t>NAME}} end</w:t></w:r></w:p>',
      ),
    );
    const output = await replaceDocxPlaceholders(input, { '{{TRAYNAME}}': 'A & B < C' });
    const xml = await xmlOf(output);
    expect(xml).toContain('A &amp; B &lt; C');
    expect(xml).toContain(' end');
    expect(xml).toContain('<w:b');
    expect(xml).not.toContain('{{TRAY');
  });
  it('handles overlapping aliases once without replacing tokens in inserted values', async () => {
    const input = await inputBlob(
      paragraphXml('<w:p><w:r><w:t>{{TRAYNAME}} TRAYNAME</w:t></w:r></w:p>'),
    );
    const xml = await xmlOf(
      await replaceDocxPlaceholders(input, { TRAYNAME: 'old', '{{TRAYNAME}}': 'TRAYNAME' }),
    );
    expect(xml).toContain('TRAYNAME old');
  });
  it('generates the shipped template entirely through Variables API, including images and cable table', async () => {
    const context = createContext();
    const bundle = buildTrayPlaceholderValues(context);
    const replacements: Record<string, string> = {},
      tables: Record<string, (typeof bundle.tables)[string]> = {},
      images: Record<
        string,
        {
          data: Uint8Array;
          widthEmu: number;
          heightEmu: number;
          fileName: string;
          contentType: string;
        }
      > = {};
    // A valid transparent PNG is enough to test OOXML image packaging.
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    for (const [rowId, token] of Object.entries(TRAY_REPORT_PLACEHOLDERS)) {
      if (bundle.tables[rowId]) tables[token] = bundle.tables[rowId];
      else if (bundle.images[rowId])
        images[token] = {
          data: png,
          widthEmu: 914400,
          heightEmu: 457200,
          fileName: rowId.replace(/:/g, '-'),
          contentType: 'image/png',
        };
      else replacements[token] = bundle.values[rowId];
    }
    const templateBytes = Uint8Array.from(
      readFileSync('Template files/ReportMacroTemplate_LV.docx'),
    );
    const template = new Blob([templateBytes]);
    const output = await replaceDocxPlaceholders(template, replacements, { tables, images });
    const bytes = await blobBytes(output);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).not.toMatch(/\{\{[A-Z]+\}\}/);
    expect(xml).toContain('PASS - Design load');
    expect(xml).toContain('LV-C001');
    expect(xml).toContain('w:tblHeader');
    expect(xml.match(/<w:drawing>/g)).toHaveLength(3);
    expect(xml).toContain('w:tblGrid');
    const drawingIds: string[] = [];
    for (const name of Object.keys(zip.files).filter((name) => /^word\/.*\.xml$/.test(name))) {
      const part = await zip.file(name)!.async('string');
      expect(part).not.toMatch(/\{\{[A-Z]+\}\}/);
      const doc = new DOMParser().parseFromString(part, 'application/xml');
      for (const node of Array.from(
        doc.getElementsByTagNameNS(
          'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
          'docPr',
        ),
      ))
        drawingIds.push(node.getAttribute('id')!);
    }
    expect(new Set(drawingIds).size).toBe(drawingIds.length);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('image/png');
    if (process.env.REPORT_QA) {
      mkdirSync('.data/report-qa', { recursive: true });
      writeFileSync('.data/report-qa/filled-example.docx', Buffer.from(bytes));
    }
  });
});
