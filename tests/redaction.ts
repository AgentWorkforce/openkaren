import { redactError, redactSecretText, redactSecrets } from '../src/redaction.js';

const telegramToken = `123456789:${'ABCDEFGHIJKLMNOPQRSTUVWXYZabc_def'}`;
const slackToken = `xoxb-123456789012-123456789012-${'abcdefghijklmnopqrstuvwxyz'}`;
const openAiKey = `sk-proj-${'abcdefghijklmnopqrstuvwxyz1234567890'}`;
const anthropicKey = `sk-ant-api03-${'abcdefghijklmnopqrstuvwxyz1234567890'}`;
const nangoKey = `nango_secret_${'abcdefghijklmnopqrstuvwxyz'}`;
const bearerToken = `Bearer ${'abcdefghijklmnopqrstuvwxyz1234567890'}`;

const tokenText = [
  `telegram ${telegramToken}`,
  `slack ${slackToken}`,
  `openai ${openAiKey}`,
  `anthropic ${anthropicKey}`,
  `nango ${nangoKey}`,
  `auth ${bearerToken}`,
].join('\n');

const redacted = redactSecretText(tokenText);
for (const secret of [telegramToken, slackToken, openAiKey, anthropicKey, nangoKey, bearerToken]) {
  if (redacted.includes(secret)) {
    throw new Error(`Expected secret to be redacted: ${secret}`);
  }
}

const object = redactSecrets({
  safe: 'visible',
  token: 'short-sensitive-value',
  nested: {
    response: `failed with ${openAiKey}`,
  },
}) as { safe?: string; token?: string; nested?: { response?: string } };

if (object.safe !== 'visible' || object.token !== '[REDACTED]') {
  throw new Error(`Expected sensitive object key redaction, got ${JSON.stringify(object)}`);
}
if (object.nested?.response?.includes(openAiKey)) {
  throw new Error(`Expected nested secret text redaction, got ${JSON.stringify(object)}`);
}

const error = redactError(new Error(`Telegram failed for ${telegramToken}`));
if (error.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ')) {
  throw new Error(`Expected error message redaction, got ${error}`);
}

console.log('redaction ok');
