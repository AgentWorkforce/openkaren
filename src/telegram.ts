import type {
  OpenKarenConfig,
  TelegramOutboundFormat,
  TelegramUpdate,
} from './types.js';

const MAX_TELEGRAM_MESSAGE_LENGTH = 3900;

export const TELEGRAM_SURFACE_ID = 'telegram';

export class TelegramBot {
  private updateOffset = 0;
  private stopped = false;
  private abortController: AbortController | null = null;

  constructor(private readonly config: OpenKarenConfig) {}

  async start(onUpdate: (update: TelegramUpdate) => void): Promise<void> {
    this.stopped = false;
    this.abortController = new AbortController();
    await this.registerCommands();
    console.info('OpenKaren Telegram polling started');

    while (!this.stopped) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.updateOffset = Math.max(this.updateOffset, update.update_id + 1);
          onUpdate(update);
        }
        if (updates.length === 0) {
          await sleep(25, this.abortController.signal).catch(() => {});
        }
      } catch (error) {
        if (this.stopped) {
          break;
        }

        console.error('Telegram polling error', {
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(2_000, this.abortController.signal).catch(() => {});
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
    this.abortController = null;
  }

  async sendText(chatId: string | number, text: string): Promise<void> {
    for (const chunk of splitTelegramMessage(text)) {
      await this.call('sendMessage', {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      });
    }
  }

  async sendFormatted(format: unknown, fallbackText: string): Promise<void> {
    const outbound = isTelegramOutboundFormat(format) ? format : {};
    if (!outbound.chatId) {
      throw new Error('Telegram outbound format requires chatId');
    }

    for (const chunk of splitTelegramMessage(fallbackText)) {
      await this.call('sendMessage', {
        chat_id: outbound.chatId,
        text: chunk,
        parse_mode: outbound.parseMode,
        disable_web_page_preview: true,
      });
    }
  }

  isAllowedChat(chatId: string): boolean {
    return (
      this.config.telegramAllowedChatIds.size === 0 ||
      this.config.telegramAllowedChatIds.has(chatId)
    );
  }

  private async registerCommands(): Promise<void> {
    await this.call('setMyCommands', {
      commands: [
        { command: 'start', description: 'Start OpenKaren and show first-run help' },
        { command: 'help', description: 'Show help and basic usage' },
        { command: 'status', description: 'Show current runtime status' },
        { command: 'integrations', description: 'Show integration wiring status' },
        { command: 'spend', description: 'Show current spend snapshot' },
        { command: 'forecast', description: 'Forecast budget exhaustion' },
        { command: 'dashboard', description: 'Show the local dashboard URL' },
        { command: 'doctor', description: 'Run a compact setup doctor check' },
        { command: 'do', description: 'Force a coding task, for example /do fix the tests' },
      ],
    });
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const response = await this.call('getUpdates', {
      offset: this.updateOffset,
      timeout: this.config.pollTimeoutSeconds,
      allowed_updates: ['message'],
    });

    if (!Array.isArray(response)) {
      return [];
    }

    return response as TelegramUpdate[];
  }

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(
      `${this.config.telegramApiBaseUrl}/bot${this.config.telegramBotToken}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abortController?.signal,
      },
    );

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; result?: unknown; description?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.description ?? `Telegram API ${method} failed`);
    }

    return payload.result;
  }
}

export function normalizeTelegramUpdate(
  surfaceId: string,
  update: TelegramUpdate,
): {
  id: string;
  surfaceId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
  text: string;
  raw: { telegram: TelegramUpdate };
  receivedAt: string;
  capability: string;
} | null {
  const message = update.message;
  if (!message?.chat?.id || !message.text) {
    return null;
  }

  const chatId = String(message.chat.id);
  const userId = message.from ? String(message.from.id) : chatId;

  return {
    id: `telegram:${update.update_id}:${message.message_id}`,
    surfaceId,
    sessionId: `bridge:user:${userId}`,
    userId,
    workspaceId: `telegram:${chatId}`,
    text: message.text,
    raw: { telegram: update },
    receivedAt: new Date(message.date * 1000).toISOString(),
    capability: 'chat',
  };
}

function splitTelegramMessage(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_TELEGRAM_MESSAGE_LENGTH) {
    chunks.push(remaining.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH));
    remaining = remaining.slice(MAX_TELEGRAM_MESSAGE_LENGTH);
  }

  chunks.push(remaining || ' ');
  return chunks;
}

function isTelegramOutboundFormat(value: unknown): value is TelegramOutboundFormat {
  return typeof value === 'object' && value !== null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Sleep aborted'));
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error('Sleep aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
