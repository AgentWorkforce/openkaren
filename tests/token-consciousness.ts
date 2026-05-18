import {
  budgetGateText,
  budgetGatText,
  forecastText,
  spendText,
  type SpendSnapshot,
} from '../src/token-consciousness.js';

const healthy: SpendSnapshot = {
  available: true,
  source: 'burn',
  budgetUsd: 75,
  spendUsd: 10,
  remainingUsd: 65,
  remainingRatio: 65 / 75,
  detail: 'ok',
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

if (!forecastText(healthy, new Date('2026-05-10T00:00:00.000Z')).includes('Run rate')) {
  throw new Error('Expected forecast text');
}

console.log('token consciousness ok');
