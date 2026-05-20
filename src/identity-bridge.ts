export type BridgeSurface = 'telegram' | 'slack' | 'relaycast';

export type IdentityBridgeInput = {
  surface: BridgeSurface;
  userId: string;
};

export type IdentityBridgeMode = 'auto' | 'explicit mapping';

export function createBridgeSessionId(
  input: IdentityBridgeInput,
  explicitMappings?: ReadonlyMap<string, string>,
): string {
  const mappedUserId =
    explicitMappings?.get(identityBridgeKey(input.surface, input.userId)) ?? input.userId;
  return `bridge:user:${normalizeBridgeUserId(mappedUserId)}`;
}

export function identityBridgeKey(surface: BridgeSurface, userId: string): string {
  return `${surface}:${userId}`;
}

export function bridgeMode(explicitMappings?: ReadonlyMap<string, string>): IdentityBridgeMode {
  return explicitMappings && explicitMappings.size > 0 ? 'explicit mapping' : 'auto';
}

function normalizeBridgeUserId(userId: string): string {
  return userId.trim().replace(/^bridge:user:/, '') || 'unknown';
}
