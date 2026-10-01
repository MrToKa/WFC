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
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('image/png');
    if (process.env.REPORT_QA) {
      mkdirSync('.data/report-qa', { recursive: true });
      writeFileSync('.data/report-qa/filled-example.docx', Buffer.from(bytes));
    }
  });
});
