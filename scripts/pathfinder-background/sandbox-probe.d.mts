export function assertSafeBrowserArguments(arguments_: unknown): true;
export function parseSandboxStatus(text: string): { pidNamespaces: true; networkNamespaces: true; seccompBpf: true; seccompTsync: boolean };
export function runSandboxProbe(): Promise<{
  status: 'PASS'; scope: string; packageVersion: string; browserVersion: string;
  browserImplementation: { sha256: string; bytes: number };
  sandbox: { pidNamespaces: true; networkNamespaces: true; seccompBpf: true; seccompTsync: boolean };
  isolation: { uid: 1000; gid: 1000; noNewPrivileges: true; dockerSeccompFilter: true; loopbackOnly: true;
    readOnlyRoot: true; temporaryBytes: number; sharedMemoryBytes: number };
  webgl: { webgl: true; version: string; renderer: string };
  ownedProcessesObserved: number; browserArgumentsSha256: string; blockedRequests: number;
}>;
