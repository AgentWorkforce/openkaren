Token Tool Policy
=================

Use token-saving tools before broad raw reads.

- For noisy shell output, prefer `rtk <command ...>` when the Rust Token Killer binary is installed. If `rtk gain` is unavailable, the installed `rtk` is the wrong package; keep output bounded manually.
- Use Tilth for structure-first code reading: symbols, callers, dependency impact, maps, and targeted sections before reading whole files.
- Use TokenSave MCP when available for semantic search, impact, callers, and cross-session code memory. Initialize/sync the project if the server says the index is missing.
- Fall back to `rg`, tight line ranges, and focused reads when a token tool is unavailable.
