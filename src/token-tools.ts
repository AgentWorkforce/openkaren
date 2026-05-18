import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { OpenKarenConfig } from './types.js';

export type TokenToolStatus = {
  id: 'rtk' | 'tilth' | 'burn' | 'wash' | 'tokensave';
  state: 'available' | 'missing';
  detail: string;
};

export function tokenToolStatuses(config: OpenKarenConfig): TokenToolStatus[] {
  return [
    rtkStatus(config.rtkCommand),
    commandStatus('tilth', config.tilthCommand, 'MCP server + AST-aware code reading', ['--help'], '--mcp'),
    commandStatus('burn', config.burnCommand, 'session attribution, spend summaries, and budget gates'),
    commandStatus('wash', config.washCommand, 'optional token cleanup filter'),
    commandStatus('tokensave', config.tokensaveCommand, 'MCP semantic code graph via `tokensave serve`'),
  ];
}

export function tokenToolsPrompt(config: OpenKarenConfig): string {
  const rtk = rtkStatus(config.rtkCommand);
  const tilth = commandStatus('tilth', config.tilthCommand, 'MCP server + AST-aware code reading', ['--help'], '--mcp');
  const tokensave = commandStatus('tokensave', config.tokensaveCommand, 'MCP semantic code graph');

  return [
    'Token tool policy:',
    rtk.state === 'available'
      ? `- RTK is active as ${config.rtkCommand}. For noisy shell commands, run \`${config.rtkCommand} <command ...>\` so output is compressed before it reaches context. Use raw commands only when RTK would hide required interactive output.`
      : `- RTK is not active: ${rtk.detail}. Keep command output bounded and avoid dumping large logs.`,
    tilth.state === 'available'
      ? `- Tilth is available as ${config.tilthCommand} and configured in .mcp.json. Use Tilth MCP/CLI for structure, symbol, caller, dependency, and line-range reads before reading whole files.`
      : `- Tilth is not active: ${tilth.detail}. Fall back to rg and tight file ranges.`,
    tokensave.state === 'available'
      ? `- TokenSave is available as ${config.tokensaveCommand} and configured in .mcp.json through \`${config.tokensaveCommand} serve\`. Prefer it for semantic search, callers, impact, and cross-session code memory after indexing.`
      : `- TokenSave is not active: ${tokensave.detail}. Fall back to Tilth/rg and keep reads small.`,
  ].join('\n');
}

export function rtkStatus(command: string): TokenToolStatus {
  if (!commandAvailable(command)) {
    return {
      id: 'rtk',
      state: 'missing',
      detail: `${command} not on PATH; install Rust Token Killer from rtk-ai/rtk`,
    };
  }

  const help = commandOutput(command, ['--help']);
  const looksLikeRustTokenKiller =
    /\bgain\b/.test(help) &&
    /\binit\b/.test(help) &&
    !/Release the project/i.test(help);
  if (!looksLikeRustTokenKiller) {
    return {
      id: 'rtk',
      state: 'missing',
      detail: `${command} exists but is not Rust Token Killer; install rtk-ai/rtk and ensure it wins PATH`,
    };
  }

  return {
    id: 'rtk',
    state: 'available',
    detail: `${command} available; use \`${command} <command ...>\` for compressed shell output`,
  };
}

export function commandAvailable(command: string): boolean {
  const executable = commandExecutable(command);
  if (executable.includes('/')) {
    return existsSync(executable);
  }

  const pathEnv = process.env.PATH ?? '';
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : [''];
  return pathEnv.split(delimiter).some((entry) => {
    const base = isAbsolute(executable) ? executable : join(entry, executable);
    return extensions.some((extension) => existsSync(`${base}${extension}`));
  });
}

function commandStatus(
  id: TokenToolStatus['id'],
  command: string,
  purpose: string,
  probeArgs: string[] = ['--help'],
  requiredOutput?: string,
): TokenToolStatus {
  if (!commandAvailable(command)) {
    return { id, state: 'missing', detail: `${command} not on PATH; ${purpose}` };
  }
  if (requiredOutput && !commandOutput(command, probeArgs).includes(requiredOutput)) {
    return { id, state: 'missing', detail: `${command} is present but does not expose ${requiredOutput}` };
  }
  return { id, state: 'available', detail: `${command} available; ${purpose}` };
}

function commandOutput(command: string, args: string[]): string {
  const result = spawnSync(commandExecutable(command), args, {
    encoding: 'utf8',
    timeout: 2_000,
  });
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function commandExecutable(command: string): string {
  return command.trim().split(/\s+/)[0] ?? command;
}
