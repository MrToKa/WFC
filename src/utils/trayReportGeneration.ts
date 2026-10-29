/** A report may continue only while its exact captured drawing and chart inputs remain current. */
export class TrayReportGeneration {
  private active = true;
  constructor(private readonly identity: string, private readonly currentIdentity: () => string) {}
  assertCurrent(): void {
    if (!this.active || this.currentIdentity() !== this.identity) throw new Error('The drawing or report inputs changed. Refresh and generate a fresh report.');
  }
  async wait<T>(operation: Promise<T>): Promise<T> {
    this.assertCurrent(); const value = await operation; this.assertCurrent(); return value;
  }
  cancel(): void { this.active = false; }
}
