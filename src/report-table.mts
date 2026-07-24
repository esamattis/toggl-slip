import type { DatabaseSync } from "node:sqlite";

import { Day } from "./day.mts";
import { readHoursByDay } from "./database.mts";
import { formatDuration } from "./format-duration.mts";

export type CellStyle =
    | "muted"
    | "positive"
    | "negative"
    | "warning"
    | "danger"
    | "celebration";

export interface TableCell {
    text: string;
    style?: CellStyle;
    href?: string;
}

export interface TableColumn {
    key: string;
    title: string;
}

export interface TableRow {
    cells: Record<string, TableCell>;
}

export interface TableModel {
    title: string;
    subtitle: string;
    columns: TableColumn[];
    rows: TableRow[];
    summary: {
        totalHours: TableCell;
        workedDays: number;
        totalSlip: TableCell;
    };
}

export interface HoursOptions {
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

interface CalculatedDay {
    day: Day;
    hours: number;
    description: string[];
    matchesFilter: boolean;
    slip: number;
    totalHours: number;
    totalSlip: number;
}

function formatTime(ms: number, decimal: boolean, workdayDuration: number) {
    if (decimal) {
        return (ms / 3_600_000).toFixed(2);
    }
    return formatDuration(ms, workdayDuration);
}

function calculateDays(
    database: DatabaseSync,
    options: HoursOptions,
): CalculatedDay[] {
    const hoursByDay = new Map(
        readHoursByDay(database, {
            start: options.start.toString(),
            end: options.end.toString(),
            exclude: options.exclude,
            filter: options.filter,
            projects: options.projects,
        }).map((row) => [row.day, row]),
    );
    const days: CalculatedDay[] = [];
    let current = options.start;
    let totalSlip = options.initialHours * 60 * 60 * 1000;
    let totalHours = 0;
    const end = options.includeCurrentDay ? options.end.nextDay() : options.end;

    while (!current.is(end)) {
        const row = hoursByDay.get(current.toString());
        const hours = row?.ms ?? 0;
        const slip = current.isOff() ? hours : hours - options.target;
        totalHours += hours;
        totalSlip += slip;
        days.push({
            day: current,
            hours,
            description: row?.descriptions ?? [],
            matchesFilter: row?.matchesFilter ?? false,
            slip,
            totalHours,
            totalSlip,
        });
        current = current.nextDay();
    }

    return days;
}

export function createHoursTable(
    database: DatabaseSync,
    options: HoursOptions,
    display: { decimal: boolean },
): TableModel {
    const days = calculateDays(database, options);
    const columns: TableColumn[] = [
        { key: "day", title: "Date" },
        { key: "hours", title: "Hours" },
        { key: "slip", title: "Slip" },
        { key: "slipTotal", title: "Total Slip" },
        { key: "type", title: "Type" },
        { key: "dayName", title: "Day" },
        { key: "description", title: "Description" },
    ];
    if (options.links) {
        columns.push({ key: "link", title: "Link" });
    }

    const visibleDays = options.last ? days.slice(-options.last) : days;
    const rows: TableRow[] = [];
    for (const row of visibleDays) {
        if (options.filter && !row.matchesFilter) continue;
        if (!options.all && row.hours === 0 && row.day.isOff()) continue;

        const missing = row.hours === 0 && !row.day.isOff();
        const extra = row.hours > 0 && row.day.isOff();
        const link = `https://track.toggl.com/reports/detailed/${process.env.TOGGL_WORKSPACE_ID}/from/${row.day}/to/${row.day}`;
        const cells: Record<string, TableCell> = {
            day: {
                text: row.day.toString(),
                style: missing ? "danger" : undefined,
            },
            hours: {
                text:
                    row.hours > 0
                        ? formatTime(row.hours, display.decimal, 0)
                        : "",
                style:
                    row.hours === 0
                        ? undefined
                        : row.day.isOff() || row.hours >= options.target
                          ? "positive"
                          : "negative",
            },
            slip: {
                text:
                    row.hours > 0
                        ? `${formatTime(row.slip, display.decimal, 0)}${extra ? " 😅" : ""}`
                        : "",
                style:
                    row.hours === 0
                        ? undefined
                        : row.slip > 5 * 60 * 60 * 1000
                          ? "celebration"
                          : row.slip < 0
                            ? "negative"
                            : "positive",
            },
            slipTotal: {
                text: formatTime(
                    row.totalSlip,
                    display.decimal,
                    options.target,
                ),
                style: row.totalSlip < 0 ? "negative" : "positive",
            },
            type: {
                text: row.day.type(),
                style: row.day.publicHoliday()
                    ? "warning"
                    : row.day.type() !== "workday"
                      ? "muted"
                      : undefined,
            },
            dayName: {
                text: row.day.dayName(),
                style: row.day.isWeekend() ? "muted" : undefined,
            },
            description: {
                text: Array.from(
                    new Set(row.description.filter((value) => value.trim())),
                ).join(", "),
            },
            link: { text: link, href: link },
        };
        rows.push({ cells });
    }

    const totalHours = days.at(-1)?.totalHours ?? 0;
    const totalSlip = days.at(-1)?.totalSlip ?? 0;
    return {
        title: "Daily hours",
        subtitle: `${options.start.toString()} to ${options.end.toString()}`,
        columns,
        rows,
        summary: {
            totalHours: {
                text: formatTime(totalHours, display.decimal, options.target),
                style: "positive",
            },
            workedDays: days.filter((day) => day.hours > 0).length,
            totalSlip: {
                text: formatTime(totalSlip, false, options.target),
                style: totalSlip < 0 ? "negative" : "positive",
            },
        },
    };
}
