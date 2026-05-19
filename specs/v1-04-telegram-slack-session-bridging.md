# OpenKaren v1 spec 04: Telegram, Slack, and session bridging

## Goal

Make multi-surface behavior launchable. Telegram and Slack should feel like two
doors into the same assistant, not two disconnected bots.

## Current state

- Telegram polling exists.
- Slack webhook normalization exists.
- Slack replies use `response_url` or `chat.postMessage`.
- Session IDs use `bridge:user:<id>` shape for bridging.
- KarenUserDO can store sessions/messages.

## Desired behavior

### Identity bridge

The runtime should consistently map surface users to a portable user identity.

For v1 local mode:

- Telegram user id maps to a bridge id.
- Slack user id maps to a bridge id.
- Explicit mapping/config should be supported when the same human has different
  Telegram and Slack IDs.

### Slack launch readiness

Slack should support:

- URL verification
- signature validation when configured
- channel allowlist
- thread-native replies
- DM/channel message handling
- graceful disabled state

### Cross-surface continuity

Recent conversation state should be available across surfaces for the same
bridged user.

## Acceptance criteria

- Slack event tests cover URL verification, allowlist, signature failure, and
  thread reply formatting.
- Telegram and Slack messages for mapped same user share state.
- `/status` reports active surfaces and bridge mode.
- Missing Slack config does not break Telegram.

## Validation

- Extend state tests for explicit identity mapping.
- Add relaycast webhook tests for Slack verification and signature failure.
- Add one cross-surface session continuity test.

