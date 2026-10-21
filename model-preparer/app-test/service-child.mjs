import { createPreparerService } from '../app/service.mjs';
const configuration = JSON.parse(process.argv[2]);
const service = await createPreparerService({ configuration, fault: async (point, details) => {
  if (point === 'beforeWork') { process.send({ barrier: true, ...details }); await new Promise(() => {}); }
} });
await service.listen(); process.send({ ready: true, address: service.address });
process.on('message', async message => { if (message === 'close') { await service.close(); process.disconnect(); } });
