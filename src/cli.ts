#!/usr/bin/env node
import { createOpenKaren } from './assistant.js';
import { loadConfig } from './config.js';

const command = process.argv[2] ?? 'start';

if (command !== 'start') {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: karen start');
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
