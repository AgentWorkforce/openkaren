# Troubleshooting Guide

## Doctor First

Run:

```sh
karen doctor
```

Resolve required failures before debugging optional integrations.

## Dashboard

- If the dashboard is unreachable, confirm Karen is running and `OPENKAREN_DASHBOARD` is not `off`.
- Keep `OPENKAREN_RELAYCAST_HOST` on `127.0.0.1` or `localhost`.
- Use `OPENKAREN_DASHBOARD_PATH` only with a leading slash.

## Telegram

- Confirm `TELEGRAM_BOT_TOKEN` is present.
- Set `TELEGRAM_ALLOWED_CHAT_IDS` for production.
- Send `good morning Karen` during launch smoke and confirm no relay work starts.

## Spend And Forecast

- Confirm the Burn or RelayBurn command is installed.
- Check `OPENKAREN_MONTHLY_BUDGET_USD`.
- Use `/spend` and `/forecast` to confirm OpenKaren-scoped budget output.

## Token Tools

Run:

```sh
karen setup token-tools --check
```

If `rtk gain` is unavailable, the installed `rtk` is the wrong package. Keep command output bounded manually until the Rust Token Killer binary is installed.

## Optional Integrations

- Slack warnings are expected when Slack is out of scope.
- Cloudflare Worker state warnings are expected when hosted state is out of scope.
- Nango warnings are expected when OAuth-backed integrations are disabled.
