import { formatSetupTokenToolsResult, setupTokenTools } from '../src/setup-token-tools.js';

const result = setupTokenTools({
  cwd: process.cwd(),
  rtkCommand: 'definitely-missing-openkaren-rtk',
  tokensaveCommand: 'definitely-missing-openkaren-tokensave',
  checkOnly: true,
});

const output = formatSetupTokenToolsResult(result);
if (!result.ok) {
  throw new Error(`Expected check-only setup to succeed, got:\n${output}`);
}
if (!output.includes('Rust Token Killer') || !output.includes('cargo install tokensave')) {
  throw new Error(`Expected setup output to explain RTK and TokenSave installs, got:\n${output}`);
}

const dryRun = setupTokenTools({
  cwd: process.cwd(),
  rtkCommand: 'definitely-missing-openkaren-rtk',
  tokensaveCommand: 'definitely-missing-openkaren-tokensave',
  dryRun: true,
  configureAgents: true,
});

if (!formatSetupTokenToolsResult(dryRun).includes('install')) {
  throw new Error('Expected dry-run setup to include install steps');
}

console.log('setup token tools ok');
