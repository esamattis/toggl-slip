import { format, addDays, startOfWeek } from "date-fns";
import chalk, { type ChalkInstance } from "chalk";
import { Table } from "console-table-printer";
import {
    command,
    run,
    string,
    option,
    optional,
    boolean,
    number,
} from "cmd-ts";

import { clearCache } from "./fetch-cache.mts";

import prettyMilliseconds from "pretty-ms";
import { togglEntries } from "./toggl-api.mts";
import { Day } from "./day.mts";

async function dailyHoursInMs(options: {
    start: Day;
    end: Day;
    exclude: string | undefined;
}) {
    const days = new Map<string, { ms: number; description: string[] }>();

    for await (const entry of togglEntries(options)) {
        const description = entry.description;
        if (options.exclude && description.includes(options.exclude)) {
            continue;
        }

        for (const timeEntry of entry.time_entries) {
            const date = format(timeEntry.start, "yyyy-MM-dd");
            const current = days.get(date) || { ms: 0, description: [] };
            const ms = timeEntry.seconds * 1000;
            days.set(date, {
                ms: current.ms + ms,
                description: [...current.description, description],
            });
        }
    }

    return days;
}

// Format hours like "1h 30m"
function formatHourMin(ms: number, options?: { color?: ChalkInstance }) {
    const text = prettyMilliseconds(ms, { hideSeconds: true });
    // const text = hours.toFixed(2);

    if (options?.color) {
        return options.color(text);
    }

    if (ms < 0) {
        return chalk.red(text);
    }
    return chalk.green(text);
}

async function slipFrom(options: {
    start: Day;
    end: Day;
    exclude: string | undefined;
    target: number;
    all: boolean;
    last: number | undefined;
}) {
    const hoursByDay = await dailyHoursInMs(options);

    let current = options.start;
    let totalSlip = 0;
    let totalHours = 0;

    const days = [];

    // Include the current day in the calculation
    const end = options.end.nextDay();

    while (!current.is(end)) {
        const { ms, description } = hoursByDay.get(current.toString()) || {
            ms: 0,
            description: [],
        };

        let slip;
        if (current.isOff()) {
            slip = ms;
        } else {
            slip = ms - options.target;
        }

        totalHours += ms;
        totalSlip += slip;

        days.push({
            day: current,
            ms,
            description,
            slip,
            totalHours,
            totalSlip,
        });

        current = current.nextDay();
    }

    const table = new Table({
        columns: [
            { name: "day", title: "Date" },
            { name: "hours", title: "Hours" },
            { name: "slip", title: "Slip" },
            { name: "slipTotal", title: "Total Slip" },
            { name: "type", title: "Type" },
            { name: "dayName", title: "Day" },
            { name: "description", title: "Description" },
        ],
    });

    const sliced = options.last ? days.slice(-options.last) : days;
    for (const row of sliced) {
        if (!options.all && row.ms === 0 && row.day.isOff()) {
            continue;
        }

        const missing = row.ms === 0 && !row.day.isOff();
        const extra = row.ms > 0 && row.day.isOff();

        let dayName: string = row.day.dayName();
        if (missing) {
            dayName = chalk.bgRed.white(dayName);
        } else if (row.day.isWeekend()) {
            dayName = chalk.gray(dayName);
        }

        let type = row.day.type();
        if (row.day.publicHoliday()) {
            type = chalk.yellow(type);
        } else if (type !== "workday") {
            type = chalk.gray(type);
        }

        table.addRow({
            dayName,
            type,
            day: missing
                ? chalk.bgRed.white(row.day.toString())
                : row.day.toString(),
            hours: formatHourMin(row.ms, {
                color:
                    row.day.isOff() || row.ms >= options.target
                        ? chalk.green
                        : chalk.red,
            }),
            slip: formatHourMin(row.slip) + (extra ? " 😅" : ""),
            slipTotal: formatHourMin(row.totalSlip),
            description: Array.from(
                new Set(row.description.filter((s) => s.trim())),
            ).join(", "),
        });
    }

    table.printTable();

    const workedDays = days.filter((day) => day.ms > 0).length;

    console.log(
        `${formatHourMin(totalHours)} in ${workedDays} days with slip of ${formatHourMin(totalSlip)}`,
    );
}

async function parseArgs(): Promise<{
    exclude: string | undefined;
    startDate: string;
    endDate: string;
    target: number;
    fresh: boolean;
    all: boolean;
    last: number | undefined;
}> {
    return await new Promise((resolve) => {
        const app = command({
            name: "toggl-slip",
            args: {
                target: option({
                    type: number,
                    description:
                        "Hour target in decimal format. Defaults to 7.5",
                    long: "target",
                    defaultValue: () => 7.5,
                    short: "t",
                }),
                last: option({
                    type: optional(number),
                    description:
                        "Show only the last N days, but still fetch from the --start-date",
                    long: "last",
                    short: "l",
                }),
                all: option({
                    // @ts-ignore
                    type: boolean,
                    long: "all",
                    short: "a",
                    description: "Show even the empty days",
                    defaultValue: () => false,
                }),
                fresh: option({
                    // @ts-ignore
                    type: boolean,
                    long: "fresh",
                    short: "f",
                    description:
                        "Clear cached requests. Use when you have made changes to your Toggl account during the day. When just playing with the flags you can use the cache. The cache is automatically cleared after 12h",
                    defaultValue: () => false,
                }),
                exclude: option({
                    type: optional(string),
                    description:
                        "Exclude time entries whose descriptions contain the given string",
                    long: "exclude",
                    short: "x",
                }),
                startDate: option({
                    type: string,
                    long: "start-date",
                    defaultValue: () => Day.startOfWeek().toString(),
                    description:
                        "Start day of the slip calculation. Defaults to the start of the current week",
                    short: "s",
                }),
                endDate: option({
                    type: string,
                    long: "end-date",
                    description:
                        "End day of the slip calculation. Defaults to the current day",
                    defaultValue: () => Day.today().toString(),
                    short: "e",
                }),
            },
            handler: (args) => {
                resolve(args);
            },
        });

        run(app, process.argv.slice(2));
    });
}

const args = await parseArgs();

if (args.fresh) {
    await clearCache();
}

await slipFrom({
    target: args.target * 60 * 60 * 1000,
    start: Day.from(args.startDate),
    end: Day.from(args.endDate),
    exclude: args.exclude,
    all: args.all,
    last: args.last,
});
