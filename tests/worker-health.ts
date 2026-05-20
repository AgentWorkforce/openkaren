import worker from '../workers/karen/src/index.js';

const env = {
  KAREN_DO: {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }),
  },
} as never;

const productionHealth = await worker.fetch(new Request('https://state.example/health'), env);
const productionJson = await productionHealth.json() as { ok?: boolean; auth?: string; durableObject?: string };
assertEqual(productionHealth.status, 200, 'production health status');
assertEqual(productionJson.ok, true, 'production health ok');
assertEqual(productionJson.auth, 'token', 'production health auth mode');
assertEqual(productionJson.durableObject, 'KarenUserDO', 'production health durable object name');

const localHealth = await worker.fetch(new Request('http://127.0.0.1/health'), env);
const localJson = await localHealth.json() as { ok?: boolean; auth?: string };
assertEqual(localHealth.status, 200, 'local health status');
assertEqual(localJson.auth, 'local-dev', 'local health auth mode');

const unauthenticatedProduction = await worker.fetch(new Request('https://state.example/sessions', {
  method: 'POST',
}), env);
const unauthenticatedJson = await unauthenticatedProduction.json() as { error?: string; auth?: string };
assertEqual(unauthenticatedProduction.status, 401, 'production unauthorized status');
assertEqual(unauthenticatedJson.error, 'unauthorized', 'production unauthorized payload');
assertEqual(unauthenticatedJson.auth, 'token', 'production unauthorized auth mode');

console.log('worker health ok');

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
