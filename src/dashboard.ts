import type { OpenKarenConfig } from './types.js';
import { tokenToolStatuses, type TokenToolStatus } from './token-tools.js';
import {
  budgetGateText,
  forecastText,
  readSpendSnapshot,
  spendText,
  type SpendSnapshot,
} from './token-consciousness.js';

export type DashboardData = {
  generatedAt: string;
  userId: string;
  spend: SpendSnapshot;
  spendText: string;
  forecastText: string;
  budgetGate: string | null;
  tagScope: Record<string, string>;
  tools: TokenToolStatus[];
};

export async function buildDashboardData(
  config: OpenKarenConfig,
  userId = config.stateUserId,
): Promise<DashboardData> {
  const spend = await readSpendSnapshot(config, userId);
  return {
    generatedAt: new Date().toISOString(),
    userId,
    spend,
    spendText: spendText(spend),
    forecastText: forecastText(spend),
    budgetGate: budgetGateText(spend),
    tagScope: spend.tagScope,
    tools: tokenToolStatuses(config),
  };
}

export function renderDashboard(data: DashboardData): string {
  const spend = data.spend;
  const percentUsed = typeof spend.remainingRatio === 'number'
    ? clamp(100 - spend.remainingRatio * 100, 0, 100)
    : null;
  const spendValue = spend.spendUsd === null ? 'Unavailable' : formatUsd(spend.spendUsd);
  const budgetValue = formatUsd(spend.budgetUsd);
  const remainingValue = spend.remainingUsd === null ? 'Unknown' : formatUsd(spend.remainingUsd);
  const tokensValue = spend.totalTokens === null ? 'Unknown' : formatInteger(spend.totalTokens);
  const status = data.budgetGate ? 'Budget blocked' : spend.available ? 'Budget open' : 'Spend unavailable';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title>OpenKaren Token Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f4;
      --ink: #20201d;
      --muted: #676b5f;
      --line: #d7d9d0;
      --panel: #ffffff;
      --accent: #0d6b57;
      --warn: #9b4d13;
      --bad: #9c2d2d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    main {
      width: min(980px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }
    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 18px;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .muted { color: var(--muted); }
    .status {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--panel);
      font-size: 14px;
      white-space: nowrap;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    .panel h2 {
      margin: 0 0 10px;
      font-size: 13px;
      line-height: 1.2;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
    }
    .value {
      font-size: 30px;
      line-height: 1.1;
      font-weight: 700;
    }
    .bar {
      height: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: #e5e7df;
      margin: 14px 0 8px;
    }
    .fill {
      height: 100%;
      width: ${percentUsed === null ? 0 : percentUsed}%;
      background: ${data.budgetGate ? 'var(--bad)' : percentUsed !== null && percentUsed > 75 ? 'var(--warn)' : 'var(--accent)'};
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 0;
      font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .wide { grid-column: 1 / -1; }
    .tools {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
    }
    .tool {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fbfbf8;
      min-width: 0;
    }
    .tool b, .tool span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 720px) {
      header { display: block; }
      .status { display: inline-block; margin-top: 14px; white-space: normal; }
      .grid, .tools { grid-template-columns: 1fr; }
      .value { font-size: 24px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>OpenKaren Token Dashboard</h1>
        <div class="muted">User ${escapeHtml(data.userId)}. Updated ${escapeHtml(data.generatedAt)}.</div>
      </div>
      <div class="status">${escapeHtml(status)}</div>
    </header>
    <section class="grid">
      <div class="panel">
        <h2>Spend</h2>
        <div class="value">${escapeHtml(spendValue)}</div>
        <div class="muted">of ${escapeHtml(budgetValue)}</div>
      </div>
      <div class="panel">
        <h2>Remaining</h2>
        <div class="value">${escapeHtml(remainingValue)}</div>
        <div class="muted">${percentUsed === null ? 'Usage unknown' : `${percentUsed.toFixed(1)}% used`}</div>
      </div>
      <div class="panel">
        <h2>Tokens</h2>
        <div class="value">${escapeHtml(tokensValue)}</div>
        <div class="muted">OpenKaren scoped</div>
      </div>
      <div class="panel">
        <h2>Source</h2>
        <div class="value">${escapeHtml(spend.source)}</div>
        <div class="muted">${escapeHtml(spend.detail)}</div>
      </div>
      <div class="panel wide">
        <h2>Tag Scope</h2>
        <pre>${escapeHtml(formatTagScope(data.tagScope))}</pre>
      </div>
      <div class="panel wide">
        <h2>Budget</h2>
        <div class="bar" aria-label="Budget usage"><div class="fill"></div></div>
        <pre>${escapeHtml(data.spendText)}</pre>
      </div>
      <div class="panel wide">
        <h2>Forecast</h2>
        <pre>${escapeHtml(data.forecastText)}</pre>
      </div>
      <div class="panel wide">
        <h2>Token Tools</h2>
        <div class="tools">
          ${data.tools.map(toolHtml).join('')}
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function toolHtml(tool: TokenToolStatus): string {
  return `<div class="tool"><b>${escapeHtml(tool.id)}: ${escapeHtml(tool.state)}</b><span class="muted">${escapeHtml(tool.detail)}</span></div>`;
}

function formatTagScope(tags: Record<string, string>): string {
  return Object.entries(tags)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
