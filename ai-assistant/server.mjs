import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const capabilities = Object.freeze({
  service: 'wfc-ai-agent',
  schemaVersion: 'wfc.ai.capabilities.v1',
  stage: 'document-analysis',
  localOnly: true,
  integrated: false,
  documentExtraction: true,
  documentAnalysisCLI: true,
  modelSearch: false,
  endpointResolution: false,
  endpointBinding: false,
  routingDispatch: false,
  externalApi: false,
  acceptsJobs: false,
});

export function createAgentServer() {
  return createServer({ requestTimeout: 5_000, headersTimeout: 5_000 }, (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Connection', 'close');

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.writeHead(405);
      response.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', acceptsJobs: false }));
      request.resume();
      return;
    }

    if (request.url === '/health') {
      response.writeHead(200);
      response.end(JSON.stringify({
        status: 'ok',
        service: 'wfc-ai-agent',
        stage: 'document-analysis',
        integrated: false,
        automationReady: false,
      }));
      return;
    }

    if (request.url === '/capabilities') {
      response.writeHead(200);
      response.end(JSON.stringify(capabilities));
      return;
    }

    response.writeHead(404);
    response.end(JSON.stringify({ error: 'NOT_FOUND', acceptsJobs: false }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createAgentServer();
  server.listen(8091, '0.0.0.0', () => {
    console.log('WFC AI document service ready on port 8091.');
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
