#!/usr/bin/env node
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
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
    restPositionals,
} from "cmd-ts";
import type { DatabaseSync } from "node:sqlite";

import { formatDuration } from "./format-duration.mts";
import { Day } from "./day.mts";
import { databasePath, openDatabase, readHoursByDay } from "./database.mts";
import { loadCsvFiles } from "./csv-loader.mts";

if (existsSync(".env")) {
    loadEnvFile();
}

function formatTime(
    ms: number,
    options: {
        color?: ChalkInstance;
        decimal: boolean;
        workdayDuration: number;
    },
) {
    let text;

    if (options.decimal) {
        text = (ms / 3600000).toFixed(2);
    } else {
        text = formatDuration(ms, options.workdayDuration);
    }

    if (options.color) {
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
    hoursByDay: Map<
        string,
        { ms: number; description: string[]; matchesFilter: boolean }
    >;

    constructor(options: HoursOptions) {
        this.options = options;
        this.hoursByDay = new Map();
    }

    loadHoursByDay(database: DatabaseSync) {
        for (const row of readHoursByDay(database, {
            start: this.options.start.toString(),
            end: this.options.end.toString(),
            exclude: this.options.exclude,
            filter: this.options.filter,
            projects: this.options.projects,
        })) {
            this.hoursByDay.set(row.day, {
                ms: row.ms,
                description: row.descriptions,
                matchesFilter: row.matchesFilter,
            });
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
            const { ms, description, matchesFilter } = this.hoursByDay.get(
                current.toString(),
            ) || {
                ms: 0,
                description: [],
                matchesFilter: false,
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
                matchesFilter,
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
            if (filter && !row.matchesFilter) {
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
                formattedHours = formatTime(row.hours, {
                    decimal,
                    workdayDuration: 0,
                    color:
                        row.day.isOff() || row.hours >= this.options.target
                            ? chalk.green
                            : chalk.red,
                });

                formattedSlip =
                    formatTime(row.slip, {
                        decimal,
                        workdayDuration: 0,
                        color:
                            row.slip > 5 * 60 * 60 * 1000
                                ? chalk.bgGreen.white
                                : undefined,
                    }) + (extra ? " 😅" : "");
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
                slipTotal: formatTime(row.totalSlip, {
                    decimal,
                    workdayDuration: this.options.target,
                }),
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
            `${formatTime(totalHours, {
                decimal,
                workdayDuration: this.options.target,
            })} in ${workedDays} days with slip of ${formatTime(totalSlip, {
                decimal: false,
                workdayDuration: this.options.target,
            })}.`,
        );
    }
}

async function parseReportArgs(argv: string[]): Promise<{
    exclude: string | undefined;
    filter: string | undefined;
    startDate: string;
    endDate: string;
    target: number;
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
            description:
                "Calculate hour slip from SQLite. Use `toggl-slip load <files...>` to import CSV exports.",
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
                        "Show only the last N days, but still calculate from the --start-date",
                    long: "last",
                    short: "l",
                }),
                initialHours: option({
                    type: optional(number),
                    description: "Initial hours to start the calculation from",
                    long: "initial-hours",
                    short: "i",
                    defaultValue: () => {
                        if (process.env.TOGGL_SLIP_INITIAL_HOURS) {
                            return (
                                parseFloat(
                                    process.env.TOGGL_SLIP_INITIAL_HOURS,
                                ) || 0
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
                exclude: option({
                    type: optional(string),
                    description:
                        "Exclude time entries from calculations whose descriptions contain the given string",
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

        run(app, argv);
    });
}

async function parseLoadArgs(argv: string[]): Promise<string[]> {
    return await new Promise((resolve) => {
        const app = command({
            name: "toggl-slip load",
            description:
                "Replace database entries with authoritative Toggl CSV exports",
            args: {
                files: restPositionals({
                    type: string,
                    displayName: "files",
                    description: "One or more Toggl .csv export files",
                }),
            },
            handler: ({ files }) => resolve(files),
        });

        run(app, argv);
    });
}

const cliArgs = process.argv.slice(2);
if (cliArgs[0] === "load") {
    const files = await parseLoadArgs(cliArgs.slice(1));
    const database = openDatabase();
    try {
        const result = loadCsvFiles(database, files);
        console.log(
            `Loaded ${result.entries} entries for ${result.days} days from ${result.files} files into ${databasePath}.`,
        );
    } finally {
        database.close();
    }
} else {
    const args = await parseReportArgs(cliArgs);
    const hasOption = (long: string, short: string) =>
        cliArgs.some(
            (argument) =>
                argument === long ||
                argument.startsWith(`${long}=`) ||
                argument === short,
        );
    const activeFilters = [
        process.env.TOGGL_SLIP_START_DATE ||
        hasOption("--start-date", "-s")
            ? `--start-date=${JSON.stringify(args.startDate)}`
            : undefined,
        process.env.TOGGL_SLIP_INITIAL_HOURS ||
        hasOption("--initial-hours", "-i")
            ? `--initial-hours=${args.initialHours ?? 0}`
            : undefined,
        args.exclude ? `--exclude=${JSON.stringify(args.exclude)}` : undefined,
        args.filter ? `--filter=${JSON.stringify(args.filter)}` : undefined,
    ].filter((value) => value !== undefined);

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

    const database = openDatabase();
    try {
        hours.loadHoursByDay(database);
        hours.printTable({
            decimal: args.decimal,
        });
        if (activeFilters.length > 0) {
            console.log(`Active filters: ${activeFilters.join(", ")}`);
        }
    } finally {
        database.close();
    }
}
