#!/usr/bin/env node
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
    flag,
} from "cmd-ts";

import { clearCache } from "./fetch-cache.mts";

import prettyMilliseconds from "pretty-ms";
import { getProjects, togglEntries } from "./toggl-api.mts";
import { Day } from "./day.mts";

// Format hours like "1h 30m"
function formatHours(
    ms: number,
    options?: { color?: ChalkInstance; decimal: boolean },
) {
    let text;

    if (options?.decimal) {
        text = (ms / 3600000).toFixed(2);
    } else {
        text = prettyMilliseconds(ms, { hideSeconds: true });
    }

    // const text = hours.toFixed(2);

    if (options?.color) {
        return options.color(text);
    }

    if (ms < 0) {
        return chalk.red(text);
    }
    return chalk.green(text);
}

interface HoursOptions {
    start: Day;
    end: Day;
    exclude: string | undefined;
    filter: string | undefined;
    target: number;
    all: boolean;
    links: boolean;
    last: number | undefined;
    projects: boolean;
    includeCurrentDay: boolean;
    initialHours: number;
}

class Hours {
    options: HoursOptions;
    hoursByDay: Map<string, { ms: number; description: string[] }>;

    constructor(options: HoursOptions) {
        this.options = options;
        this.hoursByDay = new Map();
    }

    async loadHoursByDay() {
        const projects = this.options.projects ? await getProjects() : [];
        const projectMap = new Map(projects.map((p) => [p.id, p]));

        for await (const entry of togglEntries({
            start: this.options.start,
            end: this.options.end,
        })) {
            const project = entry.project_id
                ? projectMap.get(entry.project_id)
                : undefined;

            let description = entry.description;
            if (project) {
                description = `[${project.name}] ${description}`.trim();
            }

            if (this.options.exclude) {
                let excludeFound = this.options.exclude
                    .split("|")
                    .filter((term) => term.trim().length > 0)
                    .some((exclude) =>
                        description
                            .toLowerCase()
                            .includes(exclude.toLowerCase()),
                    );

                if (excludeFound) {
                    continue;
                }
            }

            for (const timeEntry of entry.time_entries) {
                const date = format(timeEntry.start, "yyyy-MM-dd");
                const current = this.hoursByDay.get(date) || {
                    ms: 0,
                    description: [],
                };
                const ms = timeEntry.seconds * 1000;
                this.hoursByDay.set(date, {
                    ms: current.ms + ms,
                    description: [...current.description, description],
                });
            }
        }
    }

    calculateSlip() {
        let current = this.options.start;
        let totalSlip = this.options.initialHours * 60 * 60 * 1000;
        let totalHours = 0;

        const days = [];

        // Include the current day in the calculation
        const end = this.options.includeCurrentDay
            ? this.options.end.nextDay()
            : this.options.end;

        while (!current.is(end)) {
            const { ms, description } = this.hoursByDay.get(
                current.toString(),
            ) || {
                ms: 0,
                description: [],
            };

            let slip;
            if (current.isOff()) {
                slip = ms;
            } else {
                slip = ms - this.options.target;
            }

            totalHours += ms;
            totalSlip += slip;

            days.push({
                day: current,
                hours: ms,
                description,
                slip,
                totalHours,
                totalSlip,
            });

            current = current.nextDay();
        }

        return days;
    }

    printTable(options: { decimal: boolean }) {
        const decimal = options.decimal;
        const days = this.calculateSlip();
        const disabledColumns = [];
        if (!this.options.links) {
            disabledColumns.push("link");
        }

        const table = new Table({
            disabledColumns,
            columns: [
                { name: "day", title: "Date" },
                { name: "hours", title: "Hours" },
                { name: "slip", title: "Slip" },
                { name: "slipTotal", title: "Total Slip" },
                { name: "type", title: "Type" },
                { name: "dayName", title: "Day" },
                { name: "description", title: "Description" },
                { name: "link", title: "Link" },
            ],
        });

        const sliced = this.options.last
            ? days.slice(-this.options.last)
            : days;
        for (const row of sliced) {
            const filter = this.options.filter;
            if (
                filter &&
                !row.description.some((description) =>
                    description.includes(filter),
                )
            ) {
                continue;
            }

            if (!this.options.all && row.hours === 0 && row.day.isOff()) {
                continue;
            }

            const missing = row.hours === 0 && !row.day.isOff();
            const extra = row.hours > 0 && row.day.isOff();

            let dayName: string = row.day.dayName();
            if (row.day.isWeekend()) {
                dayName = chalk.gray(dayName);
            }

            let type = row.day.type();
            if (row.day.publicHoliday()) {
                type = chalk.yellow(type);
            } else if (type !== "workday") {
                type = chalk.gray(type);
            }

            let formattedHours = "";
            let formattedSlip = "";

            if (row.hours > 0) {
                formattedHours = formatHours(row.hours, {
                    decimal,
                    color:
                        row.day.isOff() || row.hours >= this.options.target
                            ? chalk.green
                            : chalk.red,
                });

                formattedSlip =
                    formatHours(row.slip, { decimal }) + (extra ? " 😅" : "");
            }

            table.addRow({
                dayName,
                type,
                link: `https://track.toggl.com/reports/detailed/${process.env.TOGGL_WORKSPACE_ID}/from/${row.day}/to/${row.day}`,
                day: missing
                    ? chalk.bgRed.white(row.day.toString())
                    : row.day.toString(),
                hours: formattedHours,
                slip: formattedSlip,
                slipTotal: formatHours(row.totalSlip, { decimal }),
                description: Array.from(
                    new Set(row.description.filter((s) => s.trim())),
                ).join(", "),
            });
        }

        table.printTable();

        const workedDays = days.filter((day) => day.hours > 0).length;
        const totalHours = days.at(-1)?.totalHours || 0;
        const totalSlip = days.at(-1)?.totalSlip || 0;

        console.log(
            `${formatHours(totalHours, { decimal })} in ${workedDays} days with slip of ${formatHours(totalSlip, { decimal })}`,
        );
    }
}

async function parseArgs(): Promise<{
    exclude: string | undefined;
    filter: string | undefined;
    startDate: string;
    endDate: string;
    target: number;
    fresh: boolean;
    all: boolean;
    projects: boolean;
    links: boolean;
    last: number | undefined;
    noCurrentDay: boolean;
    initialHours: number | undefined;
    decimal: boolean;
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
                initialHours: option({
                    type: optional(number),
                    description: "Initial hours to start the calculation from",
                    long: "initial-hours",
                    short: "i",
                    defaultValue: () => {
                        if (process.env.TOGGL_INITIAL_HOURS) {
                            return (
                                parseFloat(process.env.TOGGL_INITIAL_HOURS) || 0
                            );
                        }

                        return 0;
                    },
                }),
                links: flag({
                    type: boolean,
                    description: "Show Toggl links for each day",
                    long: "links",
                    short: "L",
                    defaultValue: () => false,
                }),
                noCurrentDay: flag({
                    type: boolean,
                    description:
                        "Do not include the current day in the calculation",
                    long: "no-current-day",
                    short: "C",
                    defaultValue: () => false,
                }),
                projects: flag({
                    type: boolean,
                    description: "Include project names in the descriptions",
                    long: "projects",
                    short: "p",
                    defaultValue: () => false,
                }),
                decimal: flag({
                    type: boolean,
                    description:
                        "Show decimal hours instead of hours and minutes",
                    long: "decimal",
                    short: "d",
                    defaultValue: () => false,
                }),
                all: flag({
                    type: boolean,
                    long: "all",
                    short: "a",
                    description: "Show even the empty days",
                    defaultValue: () => false,
                }),
                fresh: flag({
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
                        "Exclude time entries from calculcations whose descriptions contain the given string",
                    long: "exclude",
                    short: "x",
                }),
                filter: option({
                    type: optional(string),
                    description:
                        "Filter the table to only include time entries whose descriptions contain the given string. Does not affect calculations",
                    long: "filter",
                    short: "F",
                }),
                startDate: option({
                    type: string,
                    long: "start-date",
                    defaultValue: () => {
                        if (process.env.TOGGL_SLIP_START_DATE) {
                            return Day.from(
                                process.env.TOGGL_SLIP_START_DATE,
                            ).toString();
                        }

                        return Day.startOfWeek().toString();
                    },
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

const hours = new Hours({
    target: args.target * 60 * 60 * 1000,
    start: Day.from(args.startDate),
    end: Day.from(args.endDate),
    exclude: args.exclude,
    filter: args.filter,
    all: args.all,
    last: args.last,
    links: args.links,
    projects: args.projects,
    includeCurrentDay: !args.noCurrentDay,
    initialHours: args.initialHours || 0,
});

await hours.loadHoursByDay();
hours.printTable({
    decimal: args.decimal,
});
