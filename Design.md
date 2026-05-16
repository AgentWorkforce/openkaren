Technical Design
==================

The very first development principle is that it should be accessible via Telegram
first and foremost. That will be the main development path for the lead developer: [khaliqgant](https://github.com/khaliqgant/)
to drive the product. Second is that the product will build itself, both via a human
and autonomously.

# Dependencies
The product itself’s surface area should be tight and relatively small. It is more
about putting a lot of really powerful pieces together. It should use an existing user’s
AI subscription and use the existing harness.

## List
- https://github.com/AgentWorkforce/relay - multi agent orchestration vehicle. Uses this to spawn agents to do work
- https://github.com/AgentWorkforce/agent-assistant - how we can allow a subscription and override it with some of our own logic. Light harness overlay over a claude or codex subscription
- https://github.com/AgentWorkforce/relayfile - integrations should mount as files and a user can connect their integrations using teh relayfile sdk
- https://github.com/AgentWorkforce/relaycast - main communication channel and uses webhooks to listen to incoming events. Makes the agent accessible from anywhere
- https://github.com/AgentWorkforce/relaycron - scheduled tasks handler
- https://github.com/AgentWorkforce/ricky - main drive for development work
- https://github.com/AgentWorkforce/workforce - personas to coordinate differnt types of work and customizable by the user
- https://github.com/rtk-ai/rtk - token saver mechnanism, should deeply integration
- https://github.com/jahala/tilth - token saveer mechanism, deeply integrate
- https://github.com/AgentWorkforce/burn - token usage analyst, deeply integration for analysis
- https://github.com/AgentWorkforce/wash - token saver mechanism, deeply integrate
- https://github.com/aovestdipaperino/tokensave - token saver mechanism, deeply integrate

# Inspriration to draw from
- https://github.com/openclaw/openclaw
- https://github.com/nousresearch/hermes-agent
- https://github.com/nanocoai/nanoclaw
