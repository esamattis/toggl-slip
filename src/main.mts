#!/usr/bin/env node
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import {
    command,
    run,
    string,
    option,
    optional,
    boolean,
    number,
    flag,
    positional,
    restPositionals,
    subcommands,
} from "cmd-ts";

import { Day } from "./day.mts";
import {
    databasePath,
    deleteDayEntries,
    openDatabase,
} from "./database.mts";
import { loadCsvFiles } from "./csv-loader.mts";
import { createHoursTable, type HoursOptions } from "./report-table.mts";
import { createReportServer } from "./report-server.mts";
import { printTerminalTable } from "./terminal-table.mts";

if (existsSync(".env")) {
    loadEnvFile();
}

const cliArgs = process.argv.slice(2);
const reportArguments = {
    target: option({
        type: number,
        description: "Hour target in decimal format. Defaults to 7.5",
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
                return parseFloat(process.env.TOGGL_SLIP_INITIAL_HOURS) || 0;
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
        description: "Do not include the current day in the calculation",
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
        description: "Show decimal hours instead of hours and minutes",
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
                return Day.from(process.env.TOGGL_SLIP_START_DATE).toString();
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
};

interface ReportValues {
    target: number;
    startDate: string;
    endDate: string;
    exclude: string | undefined;
    filter: string | undefined;
    all: boolean;
    last: number | undefined;
    links: boolean;
    projects: boolean;
    noCurrentDay: boolean;
    initialHours: number | undefined;
}

function toHoursOptions(args: ReportValues): HoursOptions {
    return {
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
        initialHours: args.initialHours ?? 0,
    };
}

const reportCommand = command({
    name: "report",
    description: "Calculate hour slip from the SQLite database",
    args: reportArguments,
    handler: (args) => {
        const reportArgs =
            cliArgs[0] === "report" ? cliArgs.slice(1) : cliArgs;
        const hasOption = (long: string, short: string) =>
            reportArgs.some(
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
            args.exclude
                ? `--exclude=${JSON.stringify(args.exclude)}`
                : undefined,
            args.filter
                ? `--filter=${JSON.stringify(args.filter)}`
                : undefined,
        ].filter((value) => value !== undefined);

        const database = openDatabase();
        try {
            printTerminalTable(
                createHoursTable(database, toHoursOptions(args), {
                    decimal: args.decimal,
                }),
            );
            if (activeFilters.length > 0) {
                console.log(`Active filters: ${activeFilters.join(", ")}`);
            }
        } finally {
            database.close();
        }
    },
});

const serveCommand = command({
    name: "serve",
    description: "Serve the daily hours report as a web page",
    args: {
        ...reportArguments,
        host: option({
            type: string,
            long: "host",
            description: "Host address to listen on",
            defaultValue: () => "127.0.0.1",
        }),
        port: option({
            type: number,
            long: "port",
            short: "P",
            description: "HTTP port to listen on",
            defaultValue: () => 3000,
        }),
    },
    handler: async (args) => {
        const server = createReportServer({
            hours: toHoursOptions(args),
            decimal: args.decimal,
        });
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(args.port, args.host, () => {
                server.off("error", reject);
                resolve();
            });
        });

        const address = server.address();
        const port =
            typeof address === "object" && address ? address.port : args.port;
        console.log(`Daily hours available at http://${args.host}:${port}`);
    },
});

const loadCommand = command({
    name: "load",
    description: "Replace database entries with authoritative Toggl CSV exports",
    args: {
        files: restPositionals({
            type: string,
            displayName: "files",
            description: "One or more Toggl .csv export files",
        }),
    },
    handler: ({ files }) => {
        const database = openDatabase();
        try {
            const result = loadCsvFiles(database, files);
            console.log(
                `Loaded ${result.entries} entries for ${result.days} days from ${result.files} files into ${databasePath}.`,
            );
        } finally {
            database.close();
        }
    },
});

const dateString = {
    displayName: "YYYY-MM-DD",
    async from(value: string): Promise<string> {
        const day = Day.from(value);
        if (day.toString() !== value) {
            throw new Error(`Invalid date string: ${value}`);
        }
        return value;
    },
};

const deleteCommand = command({
    name: "delete",
    description: "Delete all database entries for a date",
    args: {
        date: positional({
            type: dateString,
            displayName: "date",
            description: "Date to delete in YYYY-MM-DD format",
        }),
    },
    handler: ({ date }) => {
        const database = openDatabase();
        try {
            const entries = deleteDayEntries(database, date);
            console.log(
                `Deleted ${entries} entries for ${date} from ${databasePath}.`,
            );
        } finally {
            database.close();
        }
    },
});

const app = subcommands({
    name: "toggl-slip",
    description: "Load Toggl exports and calculate hour slip from SQLite",
    cmds: {
        report: reportCommand,
        serve: serveCommand,
        load: loadCommand,
        delete: deleteCommand,
    },
});

const hasSubcommand =
    cliArgs[0] === "report" ||
    cliArgs[0] === "serve" ||
    cliArgs[0] === "load" ||
    cliArgs[0] === "delete" ||
    cliArgs[0] === "--help" ||
    cliArgs[0] === "-h";
await run(app, hasSubcommand ? cliArgs : ["report", ...cliArgs]);
