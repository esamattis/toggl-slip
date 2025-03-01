
# Toggl Track – Hour Slip Calculator

Calculate the current hour slip (tuntiliukuma, liukuma-aika) for a Toggl Track workspace.
Handles finnish holidays (arkipyhät) and weekends.

Configure following environment variables:

```
TOGGL_USERNAME=""
TOGGL_PASSWORD=""
TOGGL_WORKSPACE_ID=""
```

The `TOGGL_WORKSPACE_ID` is the id of the workspace you want to calculate the hour
slip for. You can find it in the URL of the workspace in Toggl Track.

Use Node.js 23. See [mise.toml](mise.toml)

```
❯ npm ci
❯ node src/main.mts -h
toggl-slip

OPTIONS:
  --target, -t <number>    - Hour target in decimal format. Defaults to 7.5 [optional]
  --fresh, -f <true/false> - Clear cached requests. Use when you have made changes to your Toggl account. When just playing with the flags you can use the cache [optional]
  --exclude, -x <str>      - Exclude time entries whose descriptions contain the given string [optional]
  --start-date, -s <str>   - Start day of the slip calculation. Defaults to the start of the current week [optional]
  --end-date, -e <str>     - End day of the slip calculation. Defaults to the current day [optional]

FLAGS:
  --help, -h - show help
```

<img width="710" alt="image" src="https://github.com/user-attachments/assets/c437dc5b-cfed-49e0-97c9-184fa37d0fb7" />
