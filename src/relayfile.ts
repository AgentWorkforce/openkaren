import { existsSync, watch, type FSWatcher } from 'node:fs';
import { basename, relative } from 'node:path';
import type { OpenKarenConfig } from './types.js';

export type RelayfileWatchEvent = {
  eventType: string;
  relativePath: string;
  provider: string;
  receivedAt: string;
};

export class RelayfileWatcher {
  private watcher: FSWatcher | null = null;
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly config: OpenKarenConfig,
    private readonly onEvent: (event: RelayfileWatchEvent) => void,
  ) {}

  start(): void {
    if (this.watcher || !existsSync(this.config.relayfileMountDir)) {
      return;
    }

    this.watcher = watch(
      this.config.relayfileMountDir,
      { recursive: true },
      (eventType, filename) => {
        const relativePath = normalizeRelayfilePath(String(filename ?? ''));
        if (
          !relativePath ||
          relativePath === basename(this.config.relayfileMountDir) ||
          shouldIgnorePath(relativePath)
        ) {
          return;
        }

        this.debounce(relativePath, () => {
          this.onEvent({
            eventType,
            relativePath,
            provider: providerFromPath(relativePath),
            receivedAt: new Date().toISOString(),
          });
        });
      },
    );

    console.info('OpenKaren Relayfile watcher started', {
      mount: this.config.relayfileMountDir,
    });
  }

  stop(): void {
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
    this.watcher?.close();
    this.watcher = null;
  }

  private debounce(key: string, callback: () => void): void {
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pending.delete(key);
      callback();
    }, 500);
    timer.unref?.();
    this.pending.set(key, timer);
  }
}

export function relayfileEventText(event: RelayfileWatchEvent): string {
  const path = event.relativePath.length > 160
    ? `...${event.relativePath.slice(-157)}`
    : event.relativePath;
  return `Relayfile moved: ${event.provider}/${path}. I noticed. Alarming competence, really.`;
}

export function relayfilePromptContext(config: OpenKarenConfig): string {
  const mounted = existsSync(config.relayfileMountDir);
  return [
    'Relayfile proactive watch:',
    `- mount: ${config.relayfileMountDir}`,
    `- state: ${mounted ? 'watching local mount for integration changes' : 'not mounted'}`,
    '- watched providers: github, linear, notion, slack, and any mounted workspace files',
  ].join('\n');
}

function normalizeRelayfilePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/, '');
}

function shouldIgnorePath(path: string): boolean {
  return !path ||
    path.includes('/.git/') ||
    path.endsWith('~') ||
    path.split('/').some((part) => part === '.DS_Store');
}

function providerFromPath(path: string): string {
  const [first, second] = path.split('/');
  if (first === 'github' || first === 'linear' || first === 'notion' || first === 'slack') {
    return first;
  }

  if (first === 'repos' || first === 'pulls' || second === 'pulls') {
    return 'github';
  }

  if (first === 'issues' || second === 'issues') {
    return 'linear';
  }

  return first || 'relayfile';
}

export function relativeRelayfilePath(config: OpenKarenConfig, absolutePath: string): string {
  return normalizeRelayfilePath(relative(config.relayfileMountDir, absolutePath));
}
