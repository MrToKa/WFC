export interface HostJoinProof { joined: true; removed: true; containerId: string }
export interface HostProofAcknowledgement { acknowledged: true; duplicate: boolean }
export interface HostJoinProofRecord {
  readonly schemaVersion: 'wfc.pf.host-join-proof.v1'; readonly workOwner: string; readonly owner: string; readonly project: string;
  readonly image: string; readonly runtimeInventorySha256: string; readonly attemptId: string; readonly proof: Readonly<HostJoinProof>; readonly recordSha256: string;
}
export interface HostProofJournal {
  list(): Promise<HostJoinProofRecord[]>;
  retain(input: { attemptId: string; proof: HostJoinProof }): Promise<HostJoinProofRecord>;
  retire(record: HostJoinProofRecord, acknowledgement: HostProofAcknowledgement): Promise<void>;
}
export const HOST_PROOF_JOURNAL_LIMITS: Readonly<{ files: 256; records: 255; fileBytes: 4096 }>;
export function createHostProofJournal(configuration: { workPath: string; owner: string; project: string; image: string; runtimeInventorySha256: string }, options?: { root?: string }): Promise<HostProofJournal>;
