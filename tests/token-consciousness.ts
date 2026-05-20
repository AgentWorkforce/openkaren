import {
  burnSummaryArgs,
  budgetGateText,
  budgetGatText,
  forecastText,
  openKarenBurnStampTags,
  openKarenBurnTags,
  parseBurnSpend,
  readSpendSnapshot,
  spendText,
  type SpendSnapshot,
} from '../src/token-consciousness.js';
import type { OpenKarenConfig, OpenKarenTurn } from '../src/types.js';

const healthy: SpendSnapshot = {
  available: true,
  source: 'burn',
  budgetUsd: 75,
  spendUsd: 10,
  totalTokens: 12345,
  remainingUsd: 65,
  remainingRatio: 65 / 75,
  detail: 'ok',
  tagScope: {
    app: 'openkaren',
    persona: 'karen',
    tenant: 'local',
  },
};

if (budgetGateText(healthy) !== null) {
  throw new Error('Expected healthy budget to pass');
}

if (budgetGatText(healthy) !== null) {
  throw new Error('Expected typo alias to match budget gate behavior');
}

const low: SpendSnapshot = {
  ...healthy,
  spendUsd: 70,
  remainingUsd: 5,
  remainingRatio: 5 / 75,
};

const lowGate = budgetGateText(low);
if (lowGate !== null) {
  throw new Error(`Expected low budget to downgrade through routing, not block: ${lowGate}`);
}

const exhausted: SpendSnapshot = {
  ...healthy,
  spendUsd: 80,
  remainingUsd: 0,
  remainingRatio: 0,
};

const exhaustedGate = budgetGateText(exhausted);
if (!exhaustedGate?.includes('Budget exhausted')) {
  throw new Error(`Expected exhausted budget gate, got: ${exhaustedGate}`);
}

if (!spendText(healthy).includes('Spend: $10.00')) {
  throw new Error('Expected spend text');
}

if (!spendText(healthy).includes('Tokens: 12,345')) {
  throw new Error('Expected token count text');
}

if (!forecastText(healthy, new Date('2026-05-10T00:00:00.000Z')).includes('Run rate')) {
  throw new Error('Expected forecast text');
}

const tags = openKarenBurnTags({ stateUserId: 'local' });
if (tags.app !== 'openkaren' || tags.persona !== 'karen' || tags.tenant !== 'local') {
  throw new Error(`Expected OpenKaren burn tags, got ${JSON.stringify(tags)}`);
}

const turn = {
  chatId: '123',
  text: 'ship the thing',
  message: {
    id: 'telegram:123:456',
    surfaceId: 'telegram',
    userId: '456',
    text: 'ship the thing',
    receivedAt: '2026-05-19T00:00:00.000Z',
  },
} as OpenKarenTurn;
const stampTags = openKarenBurnStampTags({ stateUserId: 'local' }, turn);
for (const [key, value] of Object.entries({
  app: 'openkaren',
  persona: 'karen',
  tenant: 'local',
  surface: 'telegram',
  surfaceUserId: '456',
  workflowId: 'openkaren-turn',
  workflowRunId: 'telegram:123:456',
  tier: 'hosted-$75',
})) {
  if (stampTags[key] !== value) {
    throw new Error(`Expected stamp tag ${key}=${value}, got ${JSON.stringify(stampTags)}`);
  }
}

const args = burnSummaryArgs({ stateUserId: 'local' });
for (const expected of ['--tag', 'app=openkaren', 'persona=karen', 'tenant=local']) {
  if (!args.includes(expected)) {
    throw new Error(`Expected burn summary args to include ${expected}: ${args.join(' ')}`);
  }
}

const zeroSpend = parseBurnSpend(JSON.stringify({ totalCost: 0, totalTokens: 0 }));
if (!zeroSpend || zeroSpend.spendUsd !== 0 || zeroSpend.totalTokens !== 0) {
  throw new Error(`Expected zero OpenKaren spend payload to parse as zero, got ${JSON.stringify(zeroSpend)}`);
}

const unavailable = await readSpendSnapshot({
  burnCommand: 'burn-missing-token-consciousness-test',
  monthlyBudgetUsd: 75,
  stateUserId: 'local',
} as OpenKarenConfig, '456');
if (
  unavailable.available !== false ||
  unavailable.source !== 'unavailable' ||
  unavailable.spendUsd !== null ||
  unavailable.tagScope.app !== 'openkaren'
) {
  throw new Error(`Expected unavailable scoped Burn snapshot, got ${JSON.stringify(unavailable)}`);
}

console.log('token consciousness ok');
