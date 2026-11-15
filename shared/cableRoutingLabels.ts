/** User-facing explanations; API diagnostics retain their exact machine code. */
export function routingDiagnosticText(value: string): string {
  return ({
    MANUAL_CALCULATION_AUTHORITY_REQUIRED: 'An administrator can save this manual route in Cable details to start its check.',
    MANUAL_ROUTE_INPUTS_CHANGED: 'The model or routing inputs changed. The manual length is waiting to be checked again.',
    MANUAL_ROUTE_ENDPOINT_CHANGED: 'A shared endpoint changed. The manual length is waiting to be checked again.',
    MANUAL_ROUTE_SUPERSEDED: 'A newer route or model change is waiting to be checked.',
    MANUAL_ROUTE_CANCELLED: 'The route check was interrupted and will be retried.',
    MANUAL_ROUTE_CALCULATION_FAILED: 'The manual route could not be checked. Review the details below.',
  } as Record<string,string>)[value] ?? value;
}
