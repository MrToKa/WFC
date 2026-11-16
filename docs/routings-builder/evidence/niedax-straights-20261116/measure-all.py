import sys, os, json, hashlib, base64, tempfile
sys.path.insert(0, '/app')
from converter import cq, cut_straight_solids, convert_step

def bounds(solids):
    boxes=[s.BoundingBox() for s in solids]
    return [min(b.xmin for b in boxes), min(b.ymin for b in boxes), min(b.zmin for b in boxes), max(b.xmax for b in boxes), max(b.ymax for b in boxes), max(b.zmax for b in boxes)]

for source in json.load(sys.stdin):
  with tempfile.TemporaryDirectory(prefix='niedax-readonly-') as folder:
    raw=base64.b64decode(source['data'])
    f=os.path.join(folder,source['filename'])
    open(f,'wb').write(raw)
    src=cq.importers.importStep(f).solids().vals()
    row={'filename':source['filename'],'sha256':hashlib.sha256(raw).hexdigest(),'solidCount':len(src),'valid':all(s.isValid() for s in src),'bounds':bounds(src),'cuts':[]}
    lengths=[1,1000,1500,5999.5] if source['filename'] in ['NDX_KL_60-603_E5_MED_214.step','NDX_KL_60-603_E3_MED_214.step','NDX_KL_60-603_F_MED_214.step','NDX_KL_60-603_MED_214.step','NDX_KL_60-303_MED_214.step'] else [1500]
    for length in lengths:
        try:
            cut=cut_straight_solids(src,length)
            row['cuts'].append({'length':length,'valid':all(s.isValid() for s in cut),'solidCount':len(cut),'bounds':bounds(cut)})
        except Exception as e:
            row['cuts'].append({'length':length,'error':str(e)})
    try:
        mesh=convert_step(f,1500)
        row['mesh1500']={'solidCount':mesh['solidCount'],'triangleCount':mesh['triangleCount'],'boundsMm':mesh['boundsMm']}
    except Exception as e:
        row['mesh1500']={'error':str(e)}
    print(json.dumps(row),flush=True)
