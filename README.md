# Toggl Track Hour Slip Calculator

Calculate hour slip (tuntiliukuma, liukuma-aika, tuntikertyma) from Toggl Track
CSV exports. Finnish public holidays and weekends are handled automatically.

Requires Node.js 26 and pnpm. The versions used by the project are configured in
[`mise.toml`](mise.toml) and [`package.json`](package.json).

## Install

```sh
pnpm install
```

## Load CSV Data

Load one or more Toggl detailed-report CSV exports:

```sh
pnpm start load toggl.csv
pnpm start load january.csv february.csv
```

Data is stored in the SQLite database at
`~/.local/share/toggl-hour-slip/toggl-hour-slip.sqlite3`. Each CSV is
authoritative for every start date it contains: existing entries for a date are
deleted before all entries for that date are inserted. Loading the same files
repeatedly is therefore idempotent. Entries that cross midnight are assigned to
their start date.

## Report

Run the report after loading CSV data:

```sh
pnpm start --start-date 2026-07-01 --end-date 2026-07-24
pnpm start --projects --exclude "Vacation|Sick" --decimal
```

The explicit `report` subcommand is also available:

```sh
pnpm start report --start-date 2026-07-01 --end-date 2026-07-24
```

## Delete Data

Delete all entries for a date:

```sh
pnpm start delete 2026-07-14
```

Use `pnpm start --help` to list subcommands and `<subcommand> --help` for
command-specific options, such as `pnpm start report --help`.

## Environment Variables

The CLI loads `.env` from the current directory when it exists.

| Variable | Purpose |
| --- | --- |
| `TOGGL_SLIP_START_DATE` | Default `--start-date` in `YYYY-MM-DD` format. |
| `TOGGL_SLIP_INITIAL_HOURS` | Default decimal value for `--initial-hours`. |
| `TOGGL_WORKSPACE_ID` | Workspace used by `--links`. |
| `TOGGL_USERNAME` | Username for the currently unused Toggl API client. |
| `TOGGL_PASSWORD` | Password for the currently unused Toggl API client. |

Environment variables provide defaults. Explicit command-line options override
their corresponding environment variables.

`TOGGL_WORKSPACE_ID` is also required by the currently unused API client.

The existing Toggl API implementation remains in the source tree but is not used
by the report or CSV loading commands.
