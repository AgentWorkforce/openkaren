await import('./doctor.ts');

if (process.env.VITEST === 'true') {
  const vitest = await import('vitest');
  vitest.test('doctor runtime', () => {});
}
