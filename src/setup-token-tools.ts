import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { commandAvailable, rtkStatus } from './token-tools.js';

export type SetupTokenToolsOptions = {
  cwd: string;
  rtkCommand: string;
  tokensaveCommand: string;
  checkOnly?: boolean;
  dryRun?: boolean;
  configureAgents?: boolean;
};

export type SetupStep = {
  tool: 'rtk' | 'tokensave';
  action: string;
  status: 'ok' | 'run' | 'skip' | 'failed';
  detail: string;
};

export type SetupTokenToolsResult = {
  ok: boolean;
  steps: SetupStep[];
};

export function setupTokenToolsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): SetupTokenToolsResult {
  return setupTokenTools({
    cwd: resolve(env.OPENKAREN_AGENT_CWD ?? process.cwd()),
    rtkCommand: env.OPENKAREN_RTK_COMMAND?.trim() || 'rtk',
    tokensaveCommand: env.OPENKAREN_TOKENSAVE_COMMAND?.trim() || 'tokensave',
    checkOnly: argv.includes('--check'),
    dryRun: argv.includes('--dry-run'),
    configureAgents: !argv.includes('--skip-agent-hooks'),
  });
}

export function setupTokenTools(options: SetupTokenToolsOptions): SetupTokenToolsResult {
  const steps: SetupStep[] = [];
  setupRtk(options, steps);
  setupTokenSave(options, steps);
  return {
    ok: steps.every((step) => step.status !== 'failed'),
    steps,
  };
}

export function formatSetupTokenToolsResult(result: SetupTokenToolsResult): string {
  return [
    result.ok ? 'Token tool setup complete.' : 'Token tool setup finished with failures.',
    ...result.steps.map((step) => {
      const marker = step.status === 'ok'
        ? 'ok'
        : step.status === 'run'
          ? 'run'
          : step.status === 'skip'
            ? 'skip'
            : 'failed';
      return `${marker} ${step.tool}: ${step.action} - ${step.detail}`;
    }),
  ].join('\n');
}

function setupRtk(options: SetupTokenToolsOptions, steps: SetupStep[]): void {
  const status = rtkStatus(options.rtkCommand);
  if (status.state === 'available') {
    steps.push({ tool: 'rtk', action: 'validate', status: 'ok', detail: status.detail });
  } else {
    steps.push({ tool: 'rtk', action: 'validate', status: 'skip', detail: status.detail });
    installMissingTool('rtk', options, steps);
  }

  if (!options.configureAgents) {
    steps.push({ tool: 'rtk', action: 'agent hooks', status: 'skip', detail: '--skip-agent-hooks set' });
    return;
  }

  if (options.checkOnly) {
    steps.push({ tool: 'rtk', action: 'agent hooks', status: 'skip', detail: 'check only; would run rtk init -g --codex' });
    return;
  }

  runStep('rtk', 'agent hooks', options, [options.rtkCommand, 'init', '-g', '--codex'], steps);
}

function setupTokenSave(options: SetupTokenToolsOptions, steps: SetupStep[]): void {
  if (commandAvailable(options.tokensaveCommand)) {
    steps.push({
      tool: 'tokensave',
      action: 'validate',
      status: 'ok',
      detail: `${options.tokensaveCommand} available`,
    });
  } else {
    steps.push({
      tool: 'tokensave',
      action: 'validate',
      status: 'skip',
      detail: `${options.tokensaveCommand} not on PATH`,
    });
    installMissingTool('tokensave', options, steps);
  }

  if (!commandAvailable(options.tokensaveCommand) && !options.dryRun && !options.checkOnly) {
    steps.push({
      tool: 'tokensave',
      action: 'project index',
      status: 'skip',
      detail: 'tokensave unavailable after install attempt',
    });
    return;
  }

  if (options.configureAgents) {
    if (options.checkOnly) {
      steps.push({
        tool: 'tokensave',
        action: 'agent hooks',
        status: 'skip',
        detail: 'check only; would run tokensave install --agent codex',
      });
    } else {
      runStep('tokensave', 'agent hooks', options, [options.tokensaveCommand, 'install', '--agent', 'codex'], steps);
    }
  }

  const projectIndex = join(options.cwd, '.tokensave');
  if (options.checkOnly) {
    steps.push({
      tool: 'tokensave',
      action: 'project index',
      status: existsSync(projectIndex) ? 'ok' : 'skip',
      detail: existsSync(projectIndex) ? `${projectIndex} exists` : `would run tokensave init in ${options.cwd}`,
    });
    return;
  }

  if (!existsSync(projectIndex)) {
    runStep('tokensave', 'project init', options, [options.tokensaveCommand, 'init'], steps);
  } else {
    steps.push({
      tool: 'tokensave',
      action: 'project init',
      status: 'ok',
      detail: `${projectIndex} exists`,
    });
  }

  runStep('tokensave', 'project sync', options, [options.tokensaveCommand, 'sync'], steps);
  runStep('tokensave', 'doctor', options, [options.tokensaveCommand, 'doctor', '--agent', 'codex'], steps);
}

function installMissingTool(
  tool: 'rtk' | 'tokensave',
  options: SetupTokenToolsOptions,
  steps: SetupStep[],
): void {
  if (options.checkOnly) {
    steps.push({
      tool,
      action: 'install',
      status: 'skip',
      detail: `check only; ${installHint(tool)}`,
    });
    return;
  }

  if (commandAvailable('brew')) {
    const install = tool === 'rtk'
      ? ['brew', 'install', 'rtk-ai/tap/rtk']
      : ['brew', 'install', 'aovestdipaperino/tap/tokensave'];
    runStep(tool, 'install', options, install, steps);
    return;
  }

  if (commandAvailable('cargo')) {
    const install = tool === 'rtk'
      ? ['cargo', 'install', '--git', 'https://github.com/rtk-ai/rtk', 'rtk']
      : ['cargo', 'install', 'tokensave'];
    runStep(tool, 'install', options, install, steps);
    return;
  }

  steps.push({
    tool,
    action: 'install',
    status: 'failed',
    detail: `no supported installer found; ${installHint(tool)}`,
  });
}

function runStep(
  tool: 'rtk' | 'tokensave',
  action: string,
  options: SetupTokenToolsOptions,
  command: string[],
  steps: SetupStep[],
): void {
  if (options.dryRun) {
    steps.push({ tool, action, status: 'run', detail: command.join(' ') });
    return;
  }

  const result = spawnSync(command[0], command.slice(1), {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0) {
    steps.push({ tool, action, status: 'ok', detail: command.join(' ') });
    return;
  }

  const detail = [
    command.join(' '),
    result.error?.message,
    result.stderr?.trim(),
  ].filter(Boolean).join(': ');
  steps.push({ tool, action, status: 'failed', detail });
}

function installHint(tool: 'rtk' | 'tokensave'): string {
  return tool === 'rtk'
    ? 'install with `brew install rtk-ai/tap/rtk` or `cargo install --git https://github.com/rtk-ai/rtk rtk`'
    : 'install with `brew install aovestdipaperino/tap/tokensave` or `cargo install tokensave`';
}
