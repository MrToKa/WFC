"""Rebuild the LV report template. Requires python-docx; tokens use Variables API."""
from pathlib import Path
from docx import Document
from docx.shared import Mm, Pt, RGBColor
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'Template files' / 'ReportMacroTemplate_LV.docx'
d = Document(TARGET)
body = d._element.body
for child in list(body):
    if child.tag != qn('w:sectPr'):
        body.remove(child)
s = d.sections[0]
s.page_width, s.page_height = Mm(210), Mm(297)
s.top_margin, s.bottom_margin = Mm(18), Mm(18)
s.left_margin, s.right_margin = Mm(22), Mm(22)
s.header_distance, s.footer_distance = Mm(8), Mm(8)
for name in ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Caption']:
    if name not in d.styles: d.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    style = d.styles[name]
    style.font.name = 'Calibri'
    style.font.color.rgb = RGBColor.from_string('111111' if name == 'Title' else '243746')
    style.paragraph_format.space_after = Pt(7)
    style.paragraph_format.line_spacing = 1.08
normal = d.styles['Normal']; normal.font.size = Pt(11)
normal.paragraph_format.widow_control = True
for name, size in [('Title', 26), ('Subtitle', 14), ('Heading 1', 17), ('Heading 2', 12), ('Caption', 9)]:
    d.styles[name].font.size = Pt(size)
    if name.startswith('Heading'):
        d.styles[name].font.bold = True
        d.styles[name].paragraph_format.space_before = Pt(12)
        d.styles[name].paragraph_format.keep_with_next = True
# Strip inherited title borders, leaving typography and whitespace.
for name in ['Title', 'Subtitle', 'Heading 1', 'Heading 2']:
    pp = d.styles[name]._element.find(qn('w:pPr'))
    if pp is not None:
        for border in list(pp.findall(qn('w:pBdr'))): pp.remove(border)
if 'ReportTable' not in d.styles:
    d.styles.add_style('ReportTable', WD_STYLE_TYPE.TABLE)
if 'Normal Table' in d.styles: d.styles['ReportTable'].base_style = d.styles['Normal Table']
d.styles['ReportTable'].font.name = 'Calibri'
d.styles['ReportTable'].font.size = Pt(10.5)
for part in [s.header, s.footer]:
    for p in part.paragraphs: p.clear()
footer = s.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
run = footer.add_run('Cable tray assessment  |  Page '); run.font.size = Pt(9)
field = OxmlElement('w:fldSimple'); field.set(qn('w:instr'), 'PAGE'); footer._p.append(field)


def p(text, style=None): return d.add_paragraph(text, style)
def heading(text, page=False):
    item = d.add_paragraph(text, 'Heading 1')
    item.paragraph_format.page_break_before = page
    return item

def table(rows, widths=(64, 102)):
    t = d.add_table(rows=0, cols=2)
    t.style = 'ReportTable'
    t.autofit = False
    for col, width in zip(t.columns, widths): col.width = Mm(width)
    for i, (label, value) in enumerate(rows):
        cells = t.add_row().cells
        for cell, width in zip(cells, widths): cell.width = Mm(width)
        cells[0].text, cells[1].text = label, value
        cells[0].paragraphs[0].runs[0].bold = True
        row_pr = t.rows[-1]._tr.get_or_add_trPr()
        row_pr.append(OxmlElement('w:cantSplit'))
        for cell in cells:
            pr = cell._tc.get_or_add_tcPr()
            mar = OxmlElement('w:tcMar')
            for side in ['top', 'bottom', 'left', 'right']:
                e = OxmlElement('w:' + side); e.set(qn('w:w'), '85'); e.set(qn('w:type'), 'dxa'); mar.append(e)
            pr.append(mar)
            for para in cell.paragraphs:
                para.paragraph_format.space_after = Pt(0)
                para.paragraph_format.line_spacing = 1.05
            if i % 2 == 0:
                shade = OxmlElement('w:shd'); shade.set(qn('w:fill'), 'F1F4F7'); pr.append(shade)
    gap = d.add_paragraph()
    gap.paragraph_format.space_after = Pt(2)
    gap.paragraph_format.line_spacing = Pt(1)
    gap.add_run().font.size = Pt(1)
    return t

p('Cable tray engineering report', 'Title')
p('{{TRAYNAME}}', 'Subtitle')
p('This report assesses the selected cable tray using its cable schedule, tray dimensions, support spacing and assigned manufacturer load curve. It records the load verification and available installation width.')
table([
    ('Project', '{{PROJECTNUMBER}}  {{PROJECTNAME}}'),
    ('Customer', '{{CUSTOMER}}'),
    ('Prepared by', '{{PREPAREDBY}}'),
    ('Generated', '{{REPORTDATE}}'),
    ('Tray purpose', '{{TRAYPURPOSE}}'),
])
heading('Assessment results')
table([
    ('Load verification', '{{LOADVERIFICATION}}'),
    ('Design load', '{{DESIGNLOAD}} kN/m'),
    ('Allowable load at selected span', '{{ALLOWABLELOAD}} kN/m'),
    ('Capacity utilization', '{{LOADUTILIZATION}}'),
    ('Remaining design load capacity', '{{LOADRESERVE}}'),
    ('Free width', '{{FREEWIDTHRESULT}}'),
    ('Free width verification', '{{FREEWIDTHVERIFICATION}}'),
])
heading('Tray and support data')
table([
    ('Manufacturer and tray type', '{{TRAYMANUFACTURER}}  {{TRAYTYPE}}'),
    ('Tray dimensions', 'Width {{TRAYWIDTH}}  Height {{TRAYHEIGHT}}  Length {{TRAYLENGTH}}'),
    ('Tray own mass per metre', '{{TRAYOWNPERMETER}}'),
    ('Support type and length', '{{SUPPORTTYPE}}  {{SUPPORTLENGTH}}'),
    ('Selected support spacing', '{{DISTANCE}}'),
    ('Support mass per piece', '{{SUPPORTWEIGHT}} kg'),
])

heading('Weight inventory', True)
p('The weight inventory includes cables, the tray and its supports along the full route length. Support mass is recorded here separately from the load carried by the tray span.')
p('Support quantities', 'Heading 2')
p('Let L be the route length and s the selected support spacing. The application uses n = floor(L / s), with at least two supports. One additional support is counted when n is at least one and the remainder L - n x s exceeds 20% of s.')
table([
    ('Support count', '{{SUPPORTSCOUNT}}'),
    ('Total support mass', '{{SUPPTOTALWEIGHT}}'),
    ('Support mass per metre', '{{SUPPWEIGHTPERMETER}}'),
])
p('Tray and cable masses', 'Heading 2')
table([
    ('Tray plus supports per metre', '{{TRAYLOADPERMETER}}'),
    ('Total tray plus support mass', '{{TRAYCALCWEIGHT}}'),
    ('Cable mass per metre', '{{CABLESWEIGHTPERMETER}}'),
    ('Total cable mass along route', '{{CABLESWEIGHTCALCULATIONS}}'),
    ('Combined inventory per metre', '{{TOTALPERPOINT}}'),
    ('Combined inventory mass', '{{TOTALCALC}}'),
])
p('{{GROUNDINGNOTE}}')
p('Cable masses are calculated from the cables routed through this tray. Each cable is assumed to occupy the full reported route length. Cable types and individual unit masses are listed in the cable schedule.')
p('Load basis', 'Heading 2')
p('The manufacturer curve is compared with the uniformly distributed cable mass plus tray own mass. Support mass is excluded from this comparison. The project safety allowance is applied to the combined cable and tray load.')

heading('Load verification', True)
table([
    ('Assigned manufacturer curve', '{{LOADCURVENAME}}'),
    ('Documented span range', '{{LOADRANGE}}'),
    ('Selected span', '{{CALCULATEDSPAN}} m'),
    ('Project safety allowance', '{{SAFETYFACTOR}}'),
    ('Cable plus tray mass per metre', '{{SPANMASS}}'),
])
p('Numerical calculation', 'Heading 2')
p('Unfactored line load uses gravity g = 9.80665 m/s² and the conversion from N/m to kN/m.')
p('{{SPANLOADFORMULA}}')
p('Design load including the project safety allowance')
p('{{DESIGNLOADFORMULA}}')
p('Allowable load is taken from the published curve point or interpolated linearly between the two surrounding span points. Capacity is not extrapolated beyond the documented range.')
p('{{ALLOWABLELOADFORMULA}}')
p('Capacity utilization equals design load divided by allowable load')
p('{{LOADUTILIZATIONFORMULA}}')
p('Remaining capacity equals allowable load minus design load')
p('{{LOADRESERVEFORMULA}}')
p('Remaining capacity {{LOADRESERVEPERCENT}}. Maximum allowable span within the curve range {{MAXALLOWABLESPAN}}.')
p('{{LOADVERIFICATION}}')
p('The load conclusion applies to the specified distributed load and curve only. It does not establish the capacity of brackets, fixings or anchors, or verify concentrated loads.')

heading('Manufacturer load curve', True)
p('{{DIAGRAMTRAYPIC}}')
p('Figure 1  Manufacturer load curve with selected span and design load', 'Caption')
p('{{LOADSTATUS}}')
heading('Installation width assessment')
p('Free space is assessed as available tray width, using the actual bundle arrangement and spacing calculated on the Tray details page. It is not a cable cross-sectional area or volume calculation.')
table([
    ('Tray width', '{{TRAYWIDTH}}'),
    ('Occupied layout width', '{{DIAMETERSSUM}}'),
    ('Cable spacing', '{{CABLESPACING}}'),
    ('Bundle spacing counted as free', '{{BUNDLESPACINGFREE}}'),
    ('Project minimum free width', '{{MINFREEWIDTH}}'),
    ('Project maximum free width', '{{MAXFREEWIDTH}}'),
])
p('Free width calculation', 'Heading 2')
p('{{FREESPACE}}')
p('{{FREEWIDTHVERIFICATION}}')

heading('Tray geometry and cable layout', True)
p('Tray geometry', 'Heading 2')
p('{{TRAYPICTURE}}')
p('Figure 2  Selected tray type illustration', 'Caption')
table([
    ('Tray overall height', '{{TRAYHEIGHT}}'),
    ('Rung height', '{{RUNGHEIGHT}}'),
    ('Useful height', '{{USEFULTRAY}}'),
])
p('Where rung geometry is defined, useful height equals tray overall height minus rung height. The layout assessment uses the configured bundles and tray dimensions.')
p('Cable schedule', 'Heading 2')
p('The following cables are routed through this tray. Unit masses are used in the distributed load calculation.')
p('{{CABLESTABLE}}')

heading('Cable laying concept', True)
p('{{FILLPICTURE}}')
p('Figure 3  Cable bundle arrangement for the selected tray', 'Caption')
# Placeholder paragraphs are deliberately single-run for interoperability.
d.core_properties.title = 'Cable tray engineering report'
d.core_properties.subject = 'LV cable tray load and installation width assessment'
d.core_properties.author = ''
d.core_properties.last_modified_by = ''
d.save(TARGET)
print(TARGET)

