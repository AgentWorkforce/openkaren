# Token Tools Guide

OpenKaren is token-conscious by default and checks tool availability through `karen doctor` and `karen setup token-tools --check`.

## Tools

- `rtk`: compresses noisy command output when the Rust Token Killer binary is installed.
- Tilth: structure-first code reading and AST-aware navigation.
- TokenSave: semantic search and cross-session code memory.
- Burn or RelayBurn: OpenKaren-scoped spend and forecast data.
- wash: optional cleanup filter for token-heavy text.

## Check Setup

```sh
karen setup token-tools --check
```

Run the setup command without `--check` only when you want Karen to install or initialize supported tool hooks.

## Release Gate

The v1 launch checklist requires `karen setup token-tools --check` and a manual `/spend` plus `/forecast` smoke. The Burn dashboard must remain OpenKaren-scoped.
