const REDACTION = '[REDACTED]';

const SECRET_PATTERNS: RegExp[] = [
  /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:nango|nango_secret)_[A-Za-z0-9_-]{16,}\b/gi,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:cf|cloudflare)[A-Za-z0-9_-]{20,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
];

const SENSITIVE_KEY_PATTERN = /(token|secret|api[_-]?key|authorization|password|credential)/i;

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSecretText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }
  if (value && typeof value === 'object') {
    return redactSecretObject(value as Record<string, unknown>);
  }
  return value;
}

export function redactSecretText(text: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, REDACTION),
    text,
  );
}

export function redactError(error: unknown): string {
  if (error instanceof Error) {
    return redactSecretText(error.message);
  }
  return redactSecretText(String(error));
}

function redactSecretObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) && entry !== null && entry !== undefined
        ? REDACTION
        : redactSecrets(entry),
    ]),
  );
}
