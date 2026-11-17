import type { PocPort } from './cadPocPorts.js';

const s = Math.SQRT1_2;
const identity = { x: 0, y: 0, z: 0, w: 1 };
const reverse = { x: 0, y: 1, z: 0, w: 0 };

/** Terminal cut-plane centers measured on the original Niedax STEP solids.
 * F and non-F revisions have the same 300x60 mm terminal envelopes. These
 * are placement frames, not routing centerlines or a straight cutting rule. */
const tee: readonly PocPort[] = [
  {
    id: 'start',
    label: 'Tee end-face (Z=-795)',
    profile: '60x300',
    local: { position: { x: -795, y: 30, z: -795 }, rotation: reverse },
  },
  {
    id: 'end',
    label: 'Tee end-face (Z=795)',
    profile: '60x300',
    local: { position: { x: -795, y: 30, z: 795 }, rotation: identity },
  },
  {
    id: 'branch',
    label: 'Tee branch end-face (X=0)',
    profile: '60x300',
    local: { position: { x: 0, y: 30, z: 0 }, rotation: { x: 0, y: s, z: 0, w: s } },
  },
];
const largeBend: readonly PocPort[] = [
  {
    id: 'start',
    label: 'Bend end-face (Z=0)',
    profile: '60x300',
    local: { position: { x: 150, y: 30, z: 0 }, rotation: identity },
  },
  {
    id: 'end',
    label: 'Bend end-face (X=-1045)',
    profile: '60x300',
    local: { position: { x: -1045, y: 30, z: -1195 }, rotation: { x: 0, y: -s, z: 0, w: s } },
  },
];

export const FITTING_SOURCES = [
  {
    filename: 'NDX_KLT_60-303_MED_214.step',
    sha256: 'd2d9934607cc4a8aac6331e732522541fe23afce08a4c621685092188b5d936f',
    ports: tee,
  },
  {
    filename: 'NDX_KLT_60-303_F_MED_214.step',
    sha256: '7f874b3f7e7c1317d768ec83329504461eac975fc2a868a943228548b124ef5f',
    ports: tee,
  },
  {
    filename: 'NDX_KLBG_60-303_MED_214.step',
    sha256: '966eba08f801d9282f66ae09914502eef8ff24415a274c78267ee98a37926ef2',
    ports: largeBend,
  },
  {
    filename: 'NDX_KLBG_60-303_F_MED_214.step',
    sha256: 'cdecadd4ded3592aa02460339feb0250c6213ea0bb2024743142ea2ec5012964',
    ports: largeBend,
  },
] as const;
