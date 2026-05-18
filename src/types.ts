import type { InboundMessage } from '@agent-assistant/sdk';

export type OpenKarenConfig = {
  telegramBotToken: string;
  telegramApiBaseUrl: string;
  telegramAllowedChatIds: Set<string>;
  relaycastEnabled: boolean;
  relaycastHost: string;
  relaycastPort: number;
  relaycastWebhookPath: string;
  relaycastWebhookSecret: string | null;
  relayfileMountDir: string;
  relayfileWorkspace: string;
  relayfileBaseUrl: string | null;
  relayfileToken: string | null;
  relaycronBaseUrl: string | null;
  relaycronApiKey: string | null;
  relaycronWebhookUrl: string | null;
  dashboardEnabled: boolean;
  dashboardPath: string;
  stateWorkerUrl: string | null;
  stateWorkerAuthToken: string | null;
  stateUserId: string;
  slackEnabled: boolean;
  slackSigningSecret: string | null;
  slackAllowedChannelIds: Set<string>;
  slackBotToken: string | null;
  slackWebhookPath: string;
  workforcePersonaDir: string;
  workforceRoutingProfile: string;
  nangoBaseUrl: string | null;
  nangoSecretKey: string | null;
  nangoWebhookPath: string;
  rtkCommand: string;
  tilthCommand: string;
  burnCommand: string;
  washCommand: string;
  tokensaveCommand: string;
  monthlyBudgetUsd: number;
  agentMode: 'relay' | 'command' | 'queue';
  agentCommand: string | null;
  agentCwd: string;
  agentTimeoutMs: number;
  agentRelayCli: string;
  agentRelayModel: string | null;
  agentRelayChannel: string;
  agentRelayWorkflow: 'single' | 'orchestrated';
  agentRelayNamePrefix: string;
  agentRelayIdleThresholdSecs: number;
  agentRelayProgressIntervalMs: number;
  questionRouterModel: string | null;
  openaiApiKey: string | null;
  dataDir: string;
  pollTimeoutSeconds: number;
};

export type QuestionRouterRoute = 'direct_answer' | 'clarify' | 'coding_task';

export type QuestionRouterIntent =
  | 'architecture'
  | 'integration_status'
  | 'runtime_status'
  | 'recent_activity'
  | 'capabilities'
  | 'skills_tools'
  | 'model_setup'
  | 'general';

export type QuestionRouterDecision = {
  route: QuestionRouterRoute;
  intent?: QuestionRouterIntent;
  reason?: string;
};

export type QuestionRouterContextPacket = {
  activeWork: string | null;
  recentMessages: Array<{ role: string; text: string }>;
  pendingWorkflows: Array<{ label: string; status: string }>;
  wiredIntegrations: string[];
  repoSummary: string | null;
  modeSummary: string[];
  skillSummary: string[];
  integrationSummary: string[];
};

export type TelegramChat = {
  id: number;
  type?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
};

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type SlackEventPayload = {
  type?: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    team?: string;
    ts?: string;
    thread_ts?: string;
  };
  team_id?: string;
  api_app_id?: string;
  response_url?: string;
};

export type SlackOutboundFormat = {
  channelId?: string;
  threadTs?: string;
  responseUrl?: string;
};

export type TelegramOutboundFormat = {
  chatId?: number | string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
};

export type RelaycastWebhookPayload = {
  id?: string;
  event_id?: string;
  type?: string;
  text?: string;
  response_url?: string;
  reply_url?: string;
  message?: {
    id?: string;
    text?: string;
    channel_id?: string;
    channelId?: string;
    thread_id?: string;
    threadId?: string;
    user_id?: string;
    userId?: string;
    created_at?: string;
    createdAt?: string;
  };
  event?: {
    id?: string;
    text?: string;
    channel_id?: string;
    channelId?: string;
    thread_id?: string;
    threadId?: string;
    user_id?: string;
    userId?: string;
    created_at?: string;
    createdAt?: string;
  };
  workspace_id?: string;
  workspaceId?: string;
  channel_id?: string;
  channelId?: string;
  thread_id?: string;
  threadId?: string;
  user_id?: string;
  userId?: string;
  created_at?: string;
  createdAt?: string;
};

export type RelaycastOutboundFormat = {
  responseUrl?: string;
  replyUrl?: string;
  workspaceId?: string;
  channelId?: string;
  threadId?: string;
};

export type OpenKarenTurn = {
  message: InboundMessage;
  chatId: string;
  text: string;
  conversation?: ConversationMessage[];
  spendSnapshot?: {
    available: boolean;
    source: string;
    budgetUsd: number;
    spendUsd: number | null;
    remainingUsd: number | null;
    remainingRatio: number | null;
    detail: string;
  };
};

export type AgentRunResult = {
  text: string;
  exitCode: number | null;
  timedOut: boolean;
  queuedPath?: string;
};

export type ConversationRole = 'user' | 'assistant';

export type ConversationMessage = {
  role: ConversationRole;
  messageId: string;
  text: string;
  createdAt: string;
};
