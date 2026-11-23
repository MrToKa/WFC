import { request, type IncomingMessage } from 'node:http';
import { buffer } from 'node:stream/consumers';

export async function analyzeDocument(
  endpoint: URL,
  secret: string,
  payload: object,
  timeoutMs = 3_600_000,
): Promise<{ status: number; result: unknown }> {
  const body = JSON.stringify(payload);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    // Wait for the entire document to finish, including before response headers arrive.
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const call = request(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: 'Bearer ' + secret,
        },
      }, resolve);
      call.on('error', reject);
      call.end(body);
    });
    const data = await buffer(response);
    const status = response.statusCode ?? 502;
    if (status === 429) return { status, result: null };
    try {
      return { status, result: JSON.parse(data.toString('utf8')) };
    } catch {
      throw new Error(`Assistant worker returned invalid JSON (HTTP ${status}).`);
    }
  } catch (error) {
    if (signal.aborted) throw new Error('Timed out waiting for the assistant worker.');
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code && /^[A-Z0-9_]+$/.test(code)) {
      throw new Error(`Connection to the assistant worker was interrupted (${code}).`);
    }
    throw error;
  }
}
