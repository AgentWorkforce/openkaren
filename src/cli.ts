#!/usr/bin/env node
import { createOpenKaren } from './assistant.js';
import { loadConfig } from './config.js';
import { formatSetupTokenToolsResult, setupTokenToolsFromEnv } from './setup-token-tools.js';

const command = process.argv[2] ?? 'start';

if (command === 'setup' && process.argv[3] === 'token-tools') {
  const result = setupTokenToolsFromEnv(process.env, process.argv.slice(4));
  console.log(formatSetupTokenToolsResult(result));
  process.exit(result.ok ? 0 : 1);
}

if (command !== 'start') {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: karen start | karen setup token-tools [--check] [--dry-run] [--skip-agent-hooks]');
  process.exit(1);
}

const runtime = createOpenKaren(loadConfig());

const shutdown = async (signal: NodeJS.Signals) => {
  console.info(`Received ${signal}; stopping OpenKaren`);
  await runtime.stop();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

await runtime.start();
