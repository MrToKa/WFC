import type { DrawingCanvas, DrawingContext } from './types.js';

export const MAX_DRAW_COMMANDS = 500_000;
export const MAX_CANVAS_AREA = 64_000_000;
export const MAX_DRAW_COMPUTE_MS = 5_000;
const OPS = {
  save: 0, restore: 0, beginPath: 0, closePath: 0, fill: 0, stroke: 0,
  fillRect: 4, strokeRect: 4, fillText: 3, moveTo: 2, lineTo: 2,
  quadraticCurveTo: 4, bezierCurveTo: 6, arc: 6, translate: 2, rotate: 1,
} as const;
const STYLE = ['fillStyle', 'strokeStyle', 'font', 'lineWidth', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin'] as const;
export type DrawingCommand = { op: keyof typeof OPS; args: (number | string | boolean)[] } | { op: 'set'; key: typeof STYLE[number]; value: string | number };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000;
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function validateDrawingCommands(value: unknown): asserts value is DrawingCommand[] {
  if (!Array.isArray(value) || value.length > MAX_DRAW_COMMANDS) throw new Error('DRAWING_COMMAND_LIMIT');
  let depth = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') throw new Error('DRAWING_COMMAND_INVALID');
    const command = raw as Record<string, unknown>;
    if (command.op === 'set') {
      if (!exact(command, ['op', 'key', 'value']) || !STYLE.includes(command.key as typeof STYLE[number]) ||
        (command.key === 'lineWidth' ? !finite(command.value) || command.value < 0 || command.value > 10000 : typeof command.value !== 'string' || command.value.length > 256 || /[\u0000-\u001f]/.test(command.value))) throw new Error('DRAWING_STYLE_INVALID');
    } else {
      if (!exact(command, ['op', 'args']) || typeof command.op !== 'string' || !Object.hasOwn(OPS, command.op) || !Array.isArray(command.args)) throw new Error('DRAWING_COMMAND_INVALID');
      const args = command.args;
      if (args.length !== OPS[command.op as keyof typeof OPS]) throw new Error('DRAWING_COMMAND_INVALID');
      for (let index = 0; index < args.length; index++) {
        if (command.op === 'fillText' && index === 0) {
          if (typeof args[index] !== 'string' || (args[index] as string).length > 1000) throw new Error('DRAWING_TEXT_LIMIT');
        } else if (command.op === 'arc' && index === 5) {
          if (typeof args[index] !== 'boolean') throw new Error('DRAWING_COMMAND_INVALID');
        } else if (!finite(args[index])) throw new Error('DRAWING_NUMBER_INVALID');
      }
      if (command.op === 'arc' && (args[2] as number) < 0) throw new Error('DRAWING_NUMBER_INVALID');
      if (command.op === 'save') { if (++depth > 32) throw new Error('DRAWING_STACK_LIMIT'); }
      if (command.op === 'restore' && --depth < 0) throw new Error('DRAWING_STACK_INVALID');
    }
  }
  if (depth !== 0) throw new Error('DRAWING_STACK_INVALID');
}

export function createRecordingCanvas(deadline = Date.now() + MAX_DRAW_COMPUTE_MS): { canvas: DrawingCanvas; context: DrawingContext; commands: DrawingCommand[] } {
  const commands: DrawingCommand[] = [];
  const push = (command: DrawingCommand) => {
    if (commands.length >= MAX_DRAW_COMMANDS) throw new Error('DRAWING_COMMAND_LIMIT');
    if (commands.length % 256 === 0 && Date.now() > deadline) throw new Error('DRAWING_COMPUTE_DEADLINE');
    commands.push(command);
  };
  const context = {} as DrawingContext;
  const canvas: DrawingCanvas = { width: 0, height: 0, getContext: () => context };
  context.canvas = canvas;
  const state: Record<string, string | number> = { fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif', lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter' };
  const stack: Record<string, string | number>[] = [];
  for (const key of STYLE) Object.defineProperty(context, key, { get: () => state[key], set: value => { state[key] = value; push({ op: 'set', key, value }); } });
  for (const op of Object.keys(OPS) as (keyof typeof OPS)[]) {
    Object.assign(context, { [op]: (...args: (number | string | boolean)[]) => {
      if (op === 'save') stack.push({ ...state });
      if (op === 'restore') { const previous = stack.pop(); if (!previous) throw new Error('DRAWING_STACK_INVALID'); Object.assign(state, previous); }
      if (op === 'arc' && args.length === 5) args.push(false);
      push({ op, args });
    } });
  }
  return { canvas, context, commands };
}

/** Replay an allowlisted DTO. Text labels remain readable when coordinates are reflected. */
export function replayDrawingCommands(context: DrawingContext, commands: DrawingCommand[], mapX: (x: number) => number = x => x, reflected = false): void {
  validateDrawingCommands(commands);
  for (const command of commands) {
    if (command.op === 'set') {
      let value = command.value;
      if (reflected && command.key === 'textAlign') value = value === 'left' ? 'right' : value === 'right' ? 'left' : value;
      Object.assign(context, { [command.key]: value }); continue;
    }
    const args = [...command.args];
    if (['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo'].includes(command.op)) {
      for (let index = 0; index < args.length; index += 2) args[index] = mapX(args[index] as number);
    } else if (command.op === 'fillText') args[1] = mapX(args[1] as number);
    else if (command.op === 'arc') {
      args[0] = mapX(args[0] as number);
      if (reflected) { args[3] = Math.PI - (args[3] as number); args[4] = Math.PI - (args[4] as number); args[5] = !args[5]; }
    } else if (command.op === 'fillRect' || command.op === 'strokeRect') {
      const start = args[0] as number, width = args[2] as number;
      args[0] = mapX(reflected ? start + width : start);
    } else if (command.op === 'translate' && (reflected || mapX(0) !== 0)) throw new Error('DRAWING_GROUP_TRANSFORM_UNSUPPORTED');
    (context[command.op] as (...values: (number | string | boolean)[]) => void)(...args);
  }
}
