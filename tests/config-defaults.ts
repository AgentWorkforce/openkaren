import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-config-defaults-'));

try {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: 'test-token',
    OPENKAREN_DATA_DIR: dataDir,
  });

  assertEqual(config.agentMode, 'relay', 'default agent mode');
  assertEqual(config.agentRelayCli, 'codex', 'default relay cli');
  assertEqual(config.agentRelayModel, null, 'default relay model');
  assertEqual(config.agentRelayChannel, 'openkaren-dev', 'default relay channel');
  assertEqual(config.agentRelayWorkflow, 'orchestrated', 'default relay workflow');
  assertEqual(config.agentRelayNamePrefix, 'OpenKarenCoder', 'default relay name prefix');
  assertEqual(config.agentRelayIdleThresholdSecs, 20, 'default relay idle threshold');
  assertEqual(config.agentRelayProgressIntervalMs, 120_000, 'default relay progress interval');
  assertEqual(config.agentTimeoutMs, 900_000, 'default agent timeout');
  assertEqual(config.relaycastPort, 7528, 'default relaycast port');
  assertEqual(config.relayfileWorkspace, 'openkaren', 'default relayfile workspace');
  assertEqual(config.relaycronBaseUrl, null, 'default relaycron base url');
  assertEqual(config.dashboardEnabled, true, 'default dashboard enabled');
  assertEqual(config.dashboardPath, '/dashboard', 'default dashboard path');
  assertEqual(config.stateWorkerUrl, null, 'default state worker url');
  assertEqual(config.stateWorkerAuthToken, null, 'default state worker auth token');
  assertEqual(config.stateUserId, 'local', 'default state user id');
  assertEqual(config.identityBridgeMappings.size, 0, 'default identity bridge mapping count');
  assertEqual(config.slackEnabled, false, 'default slack enabled');
  assertEqual(config.slackWebhookPath, '/webhooks/slack', 'default slack webhook path');
  assertEqual(config.nangoWebhookPath, '/webhooks/nango', 'default nango webhook path');
  assertEqual(config.rtkCommand, 'rtk', 'default rtk command');
  assertEqual(config.tilthCommand, 'tilth', 'default tilth command');
  assertEqual(config.burnCommand, 'burn', 'default burn command');
  assertEqual(config.washCommand, 'wash', 'default wash command');
  assertEqual(config.tokensaveCommand, 'tokensave', 'default tokensave command');
  assertEqual(config.questionRouterModel, null, 'default question router model');
  assertEqual(config.openaiApiKey, null, 'default OpenAI API key');

  const commandConfig = loadConfig({
    TELEGRAM_BOT_TOKEN: 'test-token',
    OPENKAREN_DATA_DIR: dataDir,
    OPENKAREN_AGENT_COMMAND: 'codex exec',
  });

  assertEqual(commandConfig.agentMode, 'command', 'implicit command mode');

  const disabledDashboardConfig = loadConfig({
    TELEGRAM_BOT_TOKEN: 'test-token',
    OPENKAREN_DATA_DIR: dataDir,
    OPENKAREN_DASHBOARD: 'off',
  });
  assertEqual(disabledDashboardConfig.dashboardEnabled, false, 'dashboard off switch');

  const routerConfig = loadConfig({
    TELEGRAM_BOT_TOKEN: 'test-token',
    OPENKAREN_DATA_DIR: dataDir,
    OPENKAREN_QUESTION_ROUTER_MODEL: 'gpt-test-router',
    OPENAI_API_KEY: 'sk-test',
  });

  assertEqual(routerConfig.questionRouterModel, 'gpt-test-router', 'question router model env');
  assertEqual(routerConfig.openaiApiKey, 'sk-test', 'OpenAI API key env');

  const bridgeConfig = loadConfig({
    TELEGRAM_BOT_TOKEN: 'test-token',
    OPENKAREN_DATA_DIR: dataDir,
    OPENKAREN_IDENTITY_BRIDGE_MAP: 'telegram:777=human-1,slack:U1=human-1',
  });
  assertEqual(
    bridgeConfig.identityBridgeMappings.get('telegram:777'),
    'human-1',
    'identity bridge Telegram mapping',
  );
  assertEqual(
    bridgeConfig.identityBridgeMappings.get('slack:U1'),
    'human-1',
    'identity bridge Slack mapping',
  );

  const queueConfig = loadConfig({
    TELEGRAM_BOT_TOKEN: 'test-token',
    OPENKAREN_DATA_DIR: dataDir,
    OPENKAREN_AGENT_MODE: 'queue',
  });

  assertEqual(queueConfig.agentMode, 'queue', 'explicit queue mode');

  const envFile = join(dataDir, '.env');
  await writeFile(
    envFile,
    [
      'OPENKAREN_AGENT_MODE=relay',
      'OPENKAREN_AGENT_COMMAND=',
      'OPENKAREN_RELAYCAST_ENABLED=true',
      'OPENKAREN_QUESTION_ROUTER_MODEL=gpt-env-file-router',
      'OPENAI_API_KEY=sk-env-file',
      'OPENKAREN_RELAYCRON_BASE_URL=http://127.0.0.1:4007',
      'OPENKAREN_RELAYCRON_API_KEY=ac_test',
      'OPENKAREN_RELAYCRON_WEBHOOK_URL=http://127.0.0.1:7528/webhooks/relaycron',
    ].join('\n'),
  );
  const envFileConfig = loadConfig({
    TELEGRAM_BOT_TOKEN: 'test-token',
    OPENKAREN_DATA_DIR: dataDir,
    OPENKAREN_AGENT_MODE: 'command',
    OPENKAREN_AGENT_COMMAND: 'codex exec',
    OPENKAREN_ENV_FILE: envFile,
  });

  assertEqual(envFileConfig.agentMode, 'relay', '.env overrides inherited agent mode');
  assertEqual(envFileConfig.agentCommand, null, '.env clears inherited agent command');
  assertEqual(envFileConfig.questionRouterModel, 'gpt-env-file-router', '.env question router model');
  assertEqual(envFileConfig.openaiApiKey, 'sk-env-file', '.env OpenAI API key');
  assertEqual(envFileConfig.relaycastEnabled, true, '.env relaycast enabled');
  assertEqual(
    envFileConfig.relaycronWebhookUrl,
    'http://127.0.0.1:7528/webhooks/relaycron',
    '.env relaycron webhook url',
  );

  console.log('config defaults ok');
} finally {
  await rm(dataDir, { recursive: true, force: true });
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${label} ${String(expected)}, got ${String(actual)}`);
  }
}
