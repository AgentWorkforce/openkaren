export type OpenKarenRoute =
  {
    kind: 'coding';
    reason: string;
  }
  | {
    kind: 'chat';
    reason: string;
  };

export function routeOpenKarenMessage(text: string): OpenKarenRoute {
  const normalized = text.trim().toLowerCase();

  if (!normalized) {
    return {
      kind: 'chat',
      reason: 'Empty message is conversational',
    };
  }

  if (isTelegramCommand(normalized)) {
    return {
      kind: 'chat',
      reason: 'Telegram command is handled by OpenKaren',
    };
  }

  if (isSmallTalk(normalized)) {
    return {
      kind: 'chat',
      reason: 'Low-intent conversational message',
    };
  }

  if (hasCodingIntent(normalized)) {
    return {
      kind: 'coding',
      reason: 'Telegram message contains an actionable development request',
    };
  }

  if (hasRepoAwarenessIntent(normalized)) {
    return {
      kind: 'coding',
      reason: 'Telegram message asks for repository awareness or change reporting',
    };
  }

  return {
    kind: 'chat',
    reason: 'Message does not contain enough task intent to launch a worker',
  };
}

export function isCodingTask(text: string): boolean {
  return routeOpenKarenMessage(text).kind === 'coding';
}

function isTelegramCommand(text: string): boolean {
  return text === '/start' ||
    text === '/help' ||
    text === '/status' ||
    text === '/integrations' ||
    text === '/spend' ||
    text === '/forecast' ||
    text === '/do' ||
    text.startsWith('/do ');
}

function isSmallTalk(text: string): boolean {
  const normalized = normalizeCasualText(text);
  return isGreeting(normalized) ||
    /^(thanks|thank you|thx|appreciate it|ok|okay|cool|sounds good|got it)$/.test(normalized) ||
    /^(what can you do|who are you|are you there|you there)$/.test(normalized);
}

export function isGreeting(text: string): boolean {
  const normalized = normalizeCasualText(text);
  if (!normalized) return false;

  if (/^(good\s+)?(morning|afternoon|evening)(\s+karen)?$/.test(normalized)) return true;
  if (/^(hi|hey|hello|yo|sup|hiya|howdy|greetings|gm|gn)(\s+(karen|there|openkaren))?$/.test(normalized)) {
    return true;
  }
  if (/^(hi|hey|hello|yo|hiya|howdy)[,\s]+(karen|there|openkaren)$/.test(normalized)) {
    return true;
  }
  if (/^(how are you|how's it going|how is it going|what's up|whats up|wassup|you around|are you around)(\s+karen)?$/.test(normalized)) {
    return true;
  }

  return false;
}

function hasCodingIntent(text: string): boolean {
  return /\b(add|audit|build|change|check|commit|debug|deploy|diagnose|edit|fix|implement|inspect|investigate|make|merge|open|patch|publish|refactor|release|repair|review|run|ship|test|update|wire)\b/.test(text) ||
    /\b(pr|pull request|failing|failed|failure|bug|broken|error|regression|repo|repository|branch|workflow|spec|tests?|typescript|javascript|node|worker|sdk|cli|api|webhook|dashboard)\b/.test(text) ||
    /(^|\s)(src|tests|workers|packages|docs|scripts|workflows|specs)\//.test(text) ||
    /\b[\w.-]+\.(ts|tsx|js|jsx|json|md|yml|yaml|toml|css|html)\b/.test(text);
}

function hasRepoAwarenessIntent(text: string): boolean {
  const asksForReport = /\b(what|which|show|summarize|tell me|anything)\b/.test(text) ||
    /^(changes|updates|status)\b/.test(text);
  const asksForRecency = /\b(recent|recently|latest|last|current|now)\b/.test(text);
  const asksAboutRepoState = /\b(change|changes|changed|update|updates|work|commit|commits|progress|status)\b/.test(text);

  return asksForReport && asksForRepoState(text) && (asksForRecency || asksAboutRepoState);
}

function asksForRepoState(text: string): boolean {
  return /\b(repo|repository|project|openkaren|codebase|branch|changes|commits|work)\b/.test(text) ||
    /\bwhat changes have been made\b/.test(text) ||
    /\bwhat changed\b/.test(text) ||
    /\bwhat are you working on\b/.test(text);
}

function normalizeCasualText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}'\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
