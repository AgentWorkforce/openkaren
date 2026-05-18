import { isCodingTask, routeOpenKarenMessage } from '../src/routing.js';

const codingExamples = [
  'Build yourself through Telegram',
  'fix the failing tests',
  'make tests pass',
  'commit this',
  'Update src/assistant.ts so coding tasks use relay',
  'review the repository for bugs',
  'Engage a coding assistant to make a normal response',
  'What changes have been made recently',
  'What changed in OpenKaren recently?',
  'Show me the latest commits in the repo',
  'What are you working on right now in the project?',
];

for (const example of codingExamples) {
  if (!isCodingTask(example)) {
    throw new Error(`Expected coding task: ${example}`);
  }

  const route = routeOpenKarenMessage(example);
  if (route.kind !== 'coding') {
    throw new Error(`Expected coding route for: ${example}`);
  }
}

const chatExamples = [
  '',
  'hey',
  'hello',
  'hi Karen',
  'hello there!',
  'good morning',
  'howdy Karen',
  'greetings',
  'what\'s up?',
  'you around?',
  'what can you do?',
  'thanks',
  'cool',
];

for (const example of chatExamples) {
  if (isCodingTask(example)) {
    throw new Error(`Expected chat task: ${example}`);
  }

  const route = routeOpenKarenMessage(example);
  if (route.kind !== 'chat') {
    throw new Error(`Expected chat route for: ${example}`);
  }
}

console.log('routing ok');
