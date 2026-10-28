import type {ProducerProfile} from './container-profile.mjs';
import type {ProducerDockerAdapter,ProducerSnapshot} from './producer-process.mjs';
import type {ManagedIdentity,ManagedResourceRequest,ManagedResourceResponse} from './managed-runner.mjs';
export function openManagedClient(options:{profile:ProducerProfile;identity:ManagedIdentity;runtimeInventorySha256:string;signal?:AbortSignal;
 broker:{request(id:string,payload:ManagedResourceRequest):Promise<ManagedResourceResponse>;dispose():Promise<unknown>};
 observe?:(event:ProducerSnapshot&{type:string})=>void;adapter?:ProducerDockerAdapter}):Promise<{readonly identity:ManagedIdentity;readonly snapshot:ProducerSnapshot;
 exchange(envelope:unknown):Promise<any>;close():Promise<{joined:true;containerId:string|null;removed:boolean}>}>;
