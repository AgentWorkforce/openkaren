await import('./worker-state.ts');

if (process.env.VITEST === 'true') {
  const vitest = await import('vitest');
  vitest.test('worker state runtime', () => {});
}
