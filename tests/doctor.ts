import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor } from '../src/doctor.js';

const baseEnv = {
  ...process.env,
  NODE_OPTIONS: '',
  OPENKAREN_DASHBOARD_ENABLED: 'false',
  OPENKAREN_RTK_COMMAND: 'definitely-missing-openkaren-rtk',
  OPENKAREN_TOKENSAVE_COMMAND: 'definitely-missing-openkaren-tokensave',
  OPENKAREN_BURN_COMMAND: 'definitely-missing-openkaren-burn',
  OPENKAREN_SLACK_ENABLED: 'false',
  OPENKAREN_ENV_FILE: './definitely-missing-openkaren-env-file',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_ALLOWED_CHAT_IDS: '',
  OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS: '',
};

const report = await runDoctor({
  cwd: process.cwd(),
  env: baseEnv,
});

if (!report.ok) {
  throw new Error(`Expected doctor to pass when only optional integrations are missing:\n${JSON.stringify(report, null, 2)}`);
}

for (const section of ['runtime', 'config', 'execution', 'tokenTools'] as const) {
  if (!Array.isArray(report.sections[section])) {
    throw new Error(`Expected doctor JSON section ${section}`);
  }
}

const telegram = report.sections.config.find((check) => check.id === 'telegram');
if (telegram?.severity !== 'optional' || telegram.status !== 'warn') {
  throw new Error(`Expected missing Telegram config to be optional warning, got ${JSON.stringify(telegram)}`);
}

const telegramAllowlist = report.sections.config.find((check) => check.id === 'telegram-allowlist');
if (
  telegramAllowlist?.status !== 'warn' ||
  !telegramAllowlist.message.includes('TELEGRAM_ALLOWED_CHAT_IDS is empty')
) {
  throw new Error(`Expected empty Telegram allowlist warning, got ${JSON.stringify(telegramAllowlist)}`);
}

const missingSlackSigningSecret = await runDoctor({
  cwd: process.cwd(),
  env: {
    ...baseEnv,
    OPENKAREN_SLACK_ENABLED: 'true',
    SLACK_BOT_TOKEN: 'xoxb-test',
    OPENKAREN_SLACK_BOT_TOKEN: '',
    OPENKAREN_SLACK_SIGNING_SECRET: '',
  },
});
const slack = missingSlackSigningSecret.sections.config.find((check) => check.id === 'slack');
if (
  slack?.status !== 'warn' ||
  !slack.message.includes('OPENKAREN_SLACK_SIGNING_SECRET') ||
  !slack.remediation?.includes('OPENKAREN_SLACK_SIGNING_SECRET')
) {
  throw new Error(`Expected enabled Slack without signing secret to warn with missing key, got ${JSON.stringify(slack)}`);
}
const slackAllowlist = missingSlackSigningSecret.sections.config.find((check) => check.id === 'slack-channel-allowlist');
if (slackAllowlist?.status !== 'warn' || !slackAllowlist.message.includes('OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS is empty')) {
  throw new Error(`Expected enabled Slack without channel allowlist to warn, got ${JSON.stringify(slackAllowlist)}`);
}

const unsafeDashboard = await runDoctor({
  cwd: process.cwd(),
  env: {
    ...baseEnv,
    OPENKAREN_DASHBOARD_ENABLED: 'true',
    OPENKAREN_RELAYCAST_HOST: '0.0.0.0',
  },
});
const dashboard = unsafeDashboard.sections.config.find((check) => check.id === 'dashboard');
if (dashboard?.status !== 'warn' || !dashboard.message.includes('not localhost-bound')) {
  throw new Error(`Expected non-localhost dashboard warning, got ${JSON.stringify(dashboard)}`);
}

const dashboardOffSwitch = await runDoctor({
  cwd: process.cwd(),
  env: {
    ...baseEnv,
    OPENKAREN_DASHBOARD: 'off',
    OPENKAREN_DASHBOARD_ENABLED: '',
    OPENKAREN_RELAYCAST_HOST: '0.0.0.0',
  },
});
const disabledDashboard = dashboardOffSwitch.sections.config.find((check) => check.id === 'dashboard');
if (disabledDashboard?.status !== 'pass' || disabledDashboard.message !== 'dashboard disabled') {
  throw new Error(`Expected OPENKAREN_DASHBOARD=off to disable dashboard warnings, got ${JSON.stringify(disabledDashboard)}`);
}

const redacted = await runDoctor({
  cwd: process.cwd(),
  env: {
    ...baseEnv,
    NANGO_BASE_URL: 'https://nango.example',
    NANGO_SECRET_KEY: 'nango_secret_abcdefghijklmnopqrstuvwxyz',
  },
});
const redactedJson = JSON.stringify(redacted);
if (redactedJson.includes('nango_secret_abcdefghijklmnopqrstuvwxyz')) {
  throw new Error(`Expected doctor JSON to redact secret-shaped values, got ${redactedJson}`);
}

const tmp = await mkdtemp(join(tmpdir(), 'openkaren-doctor-'));
try {
  const fakeRtk = join(tmp, 'rtk');
  await writeFile(fakeRtk, '#!/bin/sh\necho "Release the project"\n');
  await chmod(fakeRtk, 0o755);

  const collision = await runDoctor({
    cwd: process.cwd(),
    env: {
      ...baseEnv,
      PATH: `${tmp}:${process.env.PATH ?? ''}`,
      OPENKAREN_RTK_COMMAND: fakeRtk,
    },
  });
  const rtk = collision.sections.tokenTools.find((check) => check.id === 'rtk');
  if (collision.ok || rtk?.status !== 'fail' || !rtk.message.includes('unrelated npm package named rtk')) {
    throw new Error(`Expected RTK collision to be a required failure, got ${JSON.stringify(rtk)}`);
  }

  const ricky = report.sections.execution.find((check) => check.id === 'ricky');
  if (!ricky || ricky.severity !== 'required') {
    throw new Error(`Expected Ricky doctor check to remain present and required, got ${JSON.stringify(ricky)}`);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const cliDoctor = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'doctor', '--json'], {
  cwd: process.cwd(),
  env: baseEnv,
  encoding: 'utf8',
});
if (cliDoctor.status !== 0) {
  throw new Error(`Expected CLI doctor --json to exit 0, got ${cliDoctor.status}:\n${cliDoctor.stdout}\n${cliDoctor.stderr}`);
}
const parsed = JSON.parse(cliDoctor.stdout) as typeof report;
if (!parsed.sections.runtime.some((check) => check.id === 'node')) {
  throw new Error(`Expected CLI doctor JSON to contain runtime.node check: ${cliDoctor.stdout}`);
}

const setupCheck = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'src/cli.ts', 'setup', 'token-tools', '--check', '--json'],
  {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: 'utf8',
  },
);
if (setupCheck.status !== 0) {
  throw new Error(`Expected setup token-tools --check --json to exit 0, got ${setupCheck.status}:\n${setupCheck.stdout}\n${setupCheck.stderr}`);
}
const setupJson = JSON.parse(setupCheck.stdout) as { steps?: Array<{ status?: string; detail?: string }> };
if (!setupJson.steps?.some((step) => step.detail?.includes('check only'))) {
  throw new Error(`Expected setup check JSON to include read-only check-only steps: ${setupCheck.stdout}`);
}

console.log('doctor ok');
