import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Request, Response } from 'express';
import { pool } from '../db.js';
import { readCurrentEndpointBindingContext, readEndpointBindingHeads } from '../pathfinder/endpointBindingRepository.js';
import { buildReport, captureSnapshot } from '../../scripts/gvl-stage5-report.mjs';
import { gvlPilotQualitySchema } from '../../shared/gvlPilotQuality.js';

const pilotProject = 'da667921-1f13-4c1d-9f87-063d127b98ce';

async function readPilotQuality(baselinePath: string, modelVersionId: string) {
  try {
    const raw = await readFile(join(dirname(baselinePath), 'quality.json'), 'utf8');
    const view = gvlPilotQualitySchema.parse(JSON.parse(raw));
    return view.projectId === pilotProject && view.modelVersionId === modelVersionId ? view : null;
  } catch {
    return null;
  }
}

export async function serveGvlPilotReport(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'private, no-store');
  if (req.params.projectId !== pilotProject) {
    res.status(404).json({ code: 'PILOT_PROJECT_NOT_FOUND' });
    return;
  }
  try {
    const baselinePath = process.env.WFC_GVL244_PILOT_BASELINE ||
      join(process.env.PF_ROOT || '/var/lib/wfc/pathfinder', 'gvl244-stage5', 'baseline.json');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    if (baseline.projectId !== pilotProject) throw new Error('Pilot evidence belongs to a different project');
    const current = await captureSnapshot(pool, pilotProject, { readCurrentEndpointBindingContext, readEndpointBindingHeads });
    const quality = await readPilotQuality(baselinePath, baseline.current.modelVersionId);
    res.json({ ...buildReport(baseline, current), quality });
  } catch {
    res.status(503).json({ code: 'PILOT_REPORT_UNAVAILABLE', error: 'Cannot reconcile pilot evidence with the current project.' });
  }
}
