import { z } from 'zod';

const objectId = z.string().max(16).regex(/^dbid:(?:0|[1-9][0-9]*)$(?![\s\S])/u)
  .refine(value => Number(value.slice(5)) <= 2147483647);
const objectIds = z.array(objectId).min(1).max(16).refine(values => new Set(values).size === values.length);

/** Only the verifier's strict JSON receipt supplies native diagnostics. Process
 * stderr, exception messages and paths are never included in publication proof. */
export const barrierNativeDiagnosticSchema = z.object({ code: z.string().min(1).max(96),
  message: z.string().max(2048), objectIds: objectIds.optional() }).strict();
export type BarrierNativeDiagnostic = z.infer<typeof barrierNativeDiagnosticSchema>;

export const BARRIER_REFUSAL_MESSAGES = Object.freeze({
  CAPTURE_BYTES_LIMIT: 'The captured geometry exceeds the verification size limit.',
  INVALID_CAPTURE: 'The captured geometry does not satisfy the verification format.',
  PARTIAL_CAPTURE: 'The captured geometry is incomplete.',
  ARRAY_COUNT_LIMIT: 'The captured geometry exceeds a verification count limit.',
  GEOMETRY_COUNT_LIMIT: 'The captured geometry exceeds the vertex or triangle limit.',
  DEGENERATE_TRIANGLE: 'A captured triangle is collapsed or below the supported numerical resolution.',
  DUPLICATE_TRIANGLE: 'The captured geometry contains coincident or repeated triangles.',
  OPEN_SHELL: 'The captured geometry does not form a supported closed solid.',
  SHELL_COUNT_LIMIT: 'The captured geometry exceeds the closed component limit.',
  NESTED_OR_AMBIGUOUS_SHELLS: 'Closed components are nested or ambiguously grouped; their occupied volume cannot be verified.',
  KERNEL_QUALIFICATION_REFUSED: 'A closed component failed independent solid verification.',
  AMBIGUOUS_EDGE: 'More than two captured triangles share an edge.',
  INCONSISTENT_WINDING: 'Adjacent captured triangles have inconsistent orientation.',
  INVALID_LIMITS: 'The geometry verifier configuration is unsupported.',
  WORK_LIMIT: 'Geometry verification exhausted its work limit.',
  DEADLINE_EXCEEDED: 'Geometry verification exceeded its time limit.',
  MIXED_GEOMETRY_REFUSED: 'The captured geometry could not be verified as supported surfaces or solids.',
  RECEIPT_BYTES_LIMIT: 'The geometry verification result exceeds its size limit.',
  COMPONENT_SOURCE_ORDER: 'The captured geometry has inconsistent source triangle identities.',
  INVALID_FRAGMENTS: 'The captured fragment set is invalid.',
  FRAGMENT_LIMIT: 'The captured geometry exceeds the fragment limit.',
  INVALID_FRAGMENT: 'A captured fragment is incomplete or invalid.',
  INVALID_PROVENANCE: 'A captured fragment has invalid source identities or transforms.',
  PARENT_LIMIT: 'The captured geometry exceeds the selected object limit.',
  INVALID_COORDINATE: 'A captured coordinate is outside the supported numerical range.',
  INVALID_INDEX: 'A captured triangle has an invalid vertex index.',
  EMPTY_SCOPE: 'No captured fragments were supplied for verification.',
  COMPONENT_LIMIT: 'The captured geometry exceeds the connected component limit.',
  NONMANIFOLD_VERTEX: 'A closed component has disconnected faces meeting at a vertex.',
  NONMANIFOLD_EDGE: 'More than two captured triangles share an edge.',
  SURFACE_RESOLUTION_UNCONFIRMED: 'A captured surface could not be verified within the supported numerical resolution.',
  CLOSED_SOLID_QUALIFICATION_REFUSED: 'A closed component failed independent solid verification.',
  ESTIMATED_MEMORY_LIMIT: 'The captured geometry exceeds the verification memory limit.',
  ARITHMETIC_UNCERTAINTY: 'The captured geometry could not be verified within the supported numerical precision.',
  RESOURCE_LIMIT: 'The captured geometry exceeds a verification resource limit.',
} as const);

export const barrierRefusalDiagnosticCodeSchema = z.enum(Object.keys(BARRIER_REFUSAL_MESSAGES) as
  [keyof typeof BARRIER_REFUSAL_MESSAGES, ...(keyof typeof BARRIER_REFUSAL_MESSAGES)[]]);
export const barrierRefusalDiagnosticSchema = z.object({ code: barrierRefusalDiagnosticCodeSchema,
  message: z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f-\u009f]*$(?![\s\S])/u), objectIds: objectIds.optional() }).strict();
export const barrierRefusalDiagnosticsSchema = z.array(barrierRefusalDiagnosticSchema).min(1).max(4);
export type BarrierRefusalDiagnostic = z.infer<typeof barrierRefusalDiagnosticSchema>;

// The closed verifier supplies these finite code literals in its nested refusal
// message. Preserve their meaning without forwarding arbitrary native text.
const closedCauses = new Set(['collapsed_solid', 'deadline_exceeded', 'degenerate_geometry', 'disconnected_shells',
  'duplicate_triangle', 'empty_scope', 'ill_conditioned_geometry', 'incomplete_geometry', 'inconsistent_winding',
  'invalid_identity', 'invalid_index', 'invalid_limits', 'invalid_mesh', 'nonfinite_geometry', 'nonmanifold_geometry',
  'nonmanifold_vertex', 'open_geometry', 'resource_limit', 'self_intersection', 'arithmetic_uncertainty']);

/** Unknown native codes remain a terminal refusal but disclose no unrecognized
 * text. This metadata never changes whether a capture may be published. */
export function safeBarrierRefusalDiagnostics(input: readonly BarrierNativeDiagnostic[]): BarrierRefusalDiagnostic[] {
  const output: BarrierRefusalDiagnostic[] = [];
  for (const native of input.slice(0, 64)) {
    const code = barrierRefusalDiagnosticCodeSchema.safeParse(native.code);
    if (!code.success) continue;
    let message: string = BARRIER_REFUSAL_MESSAGES[code.data];
    if (code.data === 'CLOSED_SOLID_QUALIFICATION_REFUSED' || code.data === 'KERNEL_QUALIFICATION_REFUSED') {
      const suffix = /^Independent (?:unchanged )?closed-solid qualification refused: ([a-z_]+(?:; [a-z_]+){0,3})$(?![\s\S])/u.exec(native.message)?.[1];
      // The legacy verifier appends its nested code followed by a descriptive
      // message. Keep the recognized code alone; do not forward that text.
      const legacyCause = code.data === 'KERNEL_QUALIFICATION_REFUSED'
        ? /^Independent closed-solid qualification refused: ([a-z_]+): /u.exec(native.message)?.[1] : undefined;
      const causes = suffix?.split('; ') ?? (legacyCause ? [legacyCause] : undefined);
      if (causes?.every(cause => closedCauses.has(cause))) message += ` Verification reason: ${causes.join(', ')}.`;
    }
    const sources = objectIds.safeParse(native.objectIds);
    output.push({ code: code.data, message, ...(sources.success ? { objectIds: [...sources.data] } : {}) });
    if (output.length === 4) break;
  }
  return output;
}
