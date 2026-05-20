import { relayResultLifecycle } from '../src/assistant.js';
import type { AgentRunResult } from '../src/types.js';

assertEqual(
  relayResultLifecycle(result({ timedOut: true })),
  'timed_out',
  'hard timeout without relay wait status',
);
assertEqual(
  relayResultLifecycle(result({ relayWaitStatus: 'timeout' })),
  'timed_out',
  'relay wait timeout',
);
assertEqual(
  relayResultLifecycle(result({ relayWaitStatus: 'failed_to_start' })),
  'failed_to_start',
  'failed to start mapping',
);
assertEqual(
  relayResultLifecycle(result({ relayWaitStatus: 'failed_during_execution' })),
  'failed_during_execution',
  'failed during execution mapping',
);
assertEqual(
  relayResultLifecycle(result({ relayWaitStatus: 'idle' })),
  'completed',
  'successful relay mapping',
);

console.log('assistant relay lifecycle ok');

function result(overrides: Partial<AgentRunResult>): AgentRunResult {
  return {
    text: 'relay result',
    exitCode: 0,
    timedOut: false,
    ...overrides,
  };
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
