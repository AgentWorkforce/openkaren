import { nextAcknowledgement } from '../src/assistant.js';

const debugAck = nextAcknowledgement('debug the failing Telegram worker');
if (![
  'Checking the damage.',
  'I see the problem. Rude of it.',
  'This smells fixable.',
  'I will make it less wrong.',
].includes(debugAck)) {
  throw new Error(`Expected debug acknowledgement, got: ${debugAck}`);
}

const buildAck = nextAcknowledgement('implement relaycron progress updates');
if (![
  'Good. A real task.',
  'Into the code mines.',
  'Taking it apart now.',
  'Working. Elegance pending.',
].includes(buildAck)) {
  throw new Error(`Expected build acknowledgement, got: ${buildAck}`);
}

const reviewAck = nextAcknowledgement('review the integration registry');
if (![
  'Checking the damage.',
  'I found the thread. Pulling.',
  'Summoning the tiny committee.',
  'Let me bully the repo a little.',
].includes(reviewAck)) {
  throw new Error(`Expected review acknowledgement, got: ${reviewAck}`);
}

console.log('acknowledgements ok');
