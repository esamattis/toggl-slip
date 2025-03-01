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

import { z } from "zod";
import { clearCache, fetchWithCache } from "./fetch-cache.mts";

import { holidays } from "./holidays.mts";
import prettyMilliseconds from "pretty-ms";

class Day {
    constructor(year: number, month: number, day: number) {
        this.year = year;
        this.month = month;
        this.day = day;
    }

    year: number;
    month: number;
    day: number;

    toString(): string {
        return format(this.toDate(), "yyyy-MM-dd");
    }

    toDate(): Date {
        return new Date(this.year, this.month - 1, this.day);
    }

    nextDay(): Day {
        return Day.fromDate(addDays(this.toDate(), 1));
    }

    dayName(): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun" {
        return format(this.toDate(), "EE") as any;
    }

    isPublicHoliday() {
        const str = this.toString();
        return holidays.some((holiday) => {
            if (holiday.date !== str) return false;
            if (holiday.title.toLowerCase() === "Äitienpäivä") return false;
            if (holiday.title.toLowerCase() === "Isänpäivä") return false;
            return true;
        });
    }

    isOff(): boolean {
        return this.isWeekend() || this.isPublicHoliday();
    }

    type(): "work" | "holiday" | "weekend" {
        if (this.isWeekend()) return "weekend";
        if (this.isPublicHoliday()) return "holiday";
        return "work";
    }

    isWeekend(): boolean {
        const name = this.dayName();
        return name === "Sat" || name === "Sun";
    }

    is(other: Day): boolean {
        return (
            this.year === other.year &&
            this.month === other.month &&
            this.day === other.day
        );
    }

    isAfter(other: Day): boolean {
        return this.toDate().getTime() > other.toDate().getTime();
    }

    static today(): Day {
        return Day.fromDate(new Date());
    }

    static startOfWeek(): Day {
        return Day.fromDate(startOfWeek(new Date(), { weekStartsOn: 1 }));
    }

    static fromDate(date: Date): Day {
        return new Day(date.getFullYear(), date.getMonth() + 1, date.getDate());
    }

    static from(dateString: string): Day {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            throw new Error(`Invalid date string: ${dateString}`);
        }

        const [year, month, day] = dateString.split("-").map((s) => Number(s));
        return new Day(year!, month!, day!);
    }
}

// Define the TimeEntry schema
const TimeEntrySchema = z.object({
    id: z.number(),
    seconds: z.number(),
    start: z.string(),
    stop: z.string(),
    at: z.string(),
    at_tz: z.string(),
});

// Define the main schema
const TogglEntrySchema = z.object({
    user_id: z.number(),
    username: z.string(),
    project_id: z.number().nullish(),
    task_id: z.null().optional(),
    billable: z.boolean(),
    description: z.string(),
    tag_ids: z.array(z.number()),
    billable_amount_in_cents: z.null().optional(),
    hourly_rate_in_cents: z.null().optional(),
    currency: z.string(),
    time_entries: z.array(TimeEntrySchema),
    row_number: z.number(),
});

function basicAuth() {
    const user = process.env.TOGGL_USERNAME;
    const password = process.env.TOGGL_PASSWORD;
    return Buffer.from(`${user}:${password}`).toString("base64");
}

async function fetchDetailedReport(options: {
    next: string | null;
    start: Day;
    end: Day;
}) {
    const auth = basicAuth();
    const url = `https://api.track.toggl.com/reports/api/v3/workspace/${process.env.TOGGL_WORKSPACE_ID}/search/time_entries`;

    const requestBody = {
        start_date: options.start.toString(),
        end_date: options.end.toString(),
        first_row_number: options.next ? Number(options.next) : undefined,
    };

    const fetchOptions = {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
    };

    const { data: rawData, headers } = await fetchWithCache(
        url,
        fetchOptions,
        requestBody,
    );

    const data = z.array(TogglEntrySchema).parse(rawData);

    return {
        data,
        next: headers["x-next-row-number"] || null,
    };
}

async function* timeEntries(options: { start: Day; end: Day }) {
    let next: string | null = null;

    while (true) {
        const res = await fetchDetailedReport({
            next: next,
            start: options.start,
            end: options.end,
        });

        for (const entry of res.data) {
            yield entry;
        }

        if (res.next) {
            next = res.next;
        } else {
            break;
        }
    }
}

async function dailyHoursInMs(options: {
    start: Day;
    end: Day;
    exclude: string | undefined;
}) {
    const days = new Map<string, { ms: number; description: string[] }>();

    for await (const entry of timeEntries(options)) {
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

    for (const row of days) {
        if (!options.all && row.ms === 0 && row.day.isOff()) {
            continue;
        }

        const missing = row.ms === 0 && !row.day.isOff();
        const extra = row.ms > 0 && row.day.isOff();

        table.addRow({
            day: missing
                ? chalk.bgRed.white(row.day.toString())
                : row.day.toString(),
            dayName: row.day.dayName(),
            hours: formatHourMin(row.ms, {
                color:
                    extra || row.ms >= options.target ? chalk.green : chalk.red,
            }),
            slip: formatHourMin(row.slip) + (extra ? " 😅" : ""),
            slipTotal: formatHourMin(row.totalSlip),
            type: row.day.type(),
            description: Array.from(
                new Set(row.description.filter((s) => s.trim())),
            ).join(", "),
        });
    }

    table.printTable();

    console.log(
        `Total hours: ${formatHourMin(totalHours)} with slip of ${formatHourMin(totalSlip)}`,
    );
}

async function parseArgs(): Promise<{
    exclude?: string;
    startDate: string;
    endDate: string;
    target: number;
    fresh: boolean;
    all: boolean;
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
                        "Clear cached requests. Use when you have made changes to your Toggl account. When just playing with the flags you can use the cache",
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
});
