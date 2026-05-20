await import('./redaction.ts');

if (process.env.VITEST === 'true') {
  const vitest = await import('vitest');
  vitest.test('redaction runtime', () => {});
}
