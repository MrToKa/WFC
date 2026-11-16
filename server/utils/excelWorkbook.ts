import type ExcelJS from 'exceljs';
import JSZip from 'jszip';

/** Correct ExcelJS 4.4's placement of comment VML references in generated worksheets. */
export async function orderExcelWorksheetDrawings(buffer: Buffer): Promise<Buffer> {
  const archive = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const entry of Object.values(archive.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)) continue;
    const xml = await entry.async('string');
    // ExcelJS emits a self-closing legacyDrawing at the end. In CT_Worksheet it
    // must precede these later siblings, including tableParts and extLst.
    // Restrict this to the generated self-closing reference, preserving all
    // comment bodies, relationship IDs, styles, table parts and other ZIP entries.
    const drawing = /<legacyDrawing\b[^>]*\/>/.exec(xml);
    const laterSibling = /<(?:legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(xml);
    if (!drawing || !laterSibling || drawing.index < laterSibling.index) continue;
    const withoutDrawing = xml.slice(0, drawing.index) + xml.slice(drawing.index + drawing[0].length);
    archive.file(entry.name, withoutDrawing.slice(0, laterSibling.index) + drawing[0] + withoutDrawing.slice(laterSibling.index));
    changed = true;
  }
  return changed ? archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer;
}

export async function writeExcelWorkbook(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return orderExcelWorksheetDrawings(Buffer.from(await workbook.xlsx.writeBuffer()));
}
