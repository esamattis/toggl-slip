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

Use `pnpm start --help` for all report options and
`pnpm start load --help` for CSV loading help.

The existing Toggl API implementation remains in the source tree but is not used
by the report or CSV loading commands.
