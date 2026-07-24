import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { replaceDayEntries, type TimeEntry } from "./database.mts";

const REQUIRED_COLUMNS = [
    "Description",
    "Duration",
    "Member",
    "Email",
    "Project",
    "Tags",
    "Start date",
    "Start time",
    "Stop date",
    "Stop time",
] as const;

export interface LoadResult {
    files: number;
    days: number;
    entries: number;
}

function parseCsv(contents: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < contents.length; index += 1) {
        const character = contents[index]!;
        if (character === '"') {
            if (quoted && contents[index + 1] === '"') {
                field += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (character === "," && !quoted) {
            row.push(field);
            field = "";
        } else if ((character === "\n" || character === "\r") && !quoted) {
            if (character === "\r" && contents[index + 1] === "\n") {
                index += 1;
            }
            row.push(field);
            if (row.some((value) => value.length > 0)) {
                rows.push(row);
            }
            row = [];
            field = "";
        } else {
            field += character;
        }
    }

    if (quoted) {
        throw new Error("CSV contains an unterminated quoted field");
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function durationSeconds(duration: string, location: string): number {
    if (duration === "-") {
        return 0;
    }
    const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(duration);
    if (!match) {
        throw new Error(`${location}: invalid duration ${JSON.stringify(duration)}`);
    }
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseFile(path: string): Map<string, TimeEntry[]> {
    if (extname(path).toLowerCase() !== ".csv") {
        throw new Error(`${path}: expected a .csv file`);
    }

    const rows = parseCsv(readFileSync(path, "utf8"));
    const header = rows.shift();
    if (!header) {
        throw new Error(`${path}: CSV file is empty`);
    }
    header[0] = header[0]?.replace(/^\uFEFF/, "") ?? "";

    const columns = new Map(header.map((name, index) => [name, index]));
    for (const name of REQUIRED_COLUMNS) {
        if (!columns.has(name)) {
            throw new Error(`${path}: missing ${JSON.stringify(name)} column`);
        }
    }

    const value = (row: string[], name: (typeof REQUIRED_COLUMNS)[number]) =>
        row[columns.get(name)!] ?? "";
    const byDay = new Map<string, TimeEntry[]>();

    rows.forEach((row, index) => {
        const location = `${path}:${index + 2}`;
        if (row.length !== header.length) {
            throw new Error(
                `${location}: expected ${header.length} columns, received ${row.length}`,
            );
        }

        const day = value(row, "Start date");
        const stopDate = value(row, "Stop date");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            throw new Error(`${location}: invalid start date ${JSON.stringify(day)}`);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(stopDate)) {
            throw new Error(
                `${location}: invalid stop date ${JSON.stringify(stopDate)}`,
            );
        }

        const project = value(row, "Project");
        const tags = value(row, "Tags");
        const entry: TimeEntry = {
            day,
            description: value(row, "Description"),
            durationSeconds: durationSeconds(value(row, "Duration"), location),
            member: value(row, "Member"),
            email: value(row, "Email"),
            project: project === "-" || project === "" ? null : project,
            tags: tags === "-" || tags === "" ? null : tags,
            startTime: value(row, "Start time"),
            stopDate,
            stopTime: value(row, "Stop time"),
        };
        const entries = byDay.get(day) ?? [];
        entries.push(entry);
        byDay.set(day, entries);
    });

    return byDay;
}

export function loadCsvFiles(database: DatabaseSync, paths: string[]): LoadResult {
    if (paths.length === 0) {
        throw new Error("Provide at least one .csv file");
    }

    const files = paths.map((path) => ({ path, byDay: parseFile(path) }));
    let days = 0;
    let entries = 0;

    for (const file of files) {
        for (const [day, dayEntries] of file.byDay) {
            replaceDayEntries(database, day, dayEntries);
            days += 1;
            entries += dayEntries.length;
        }
    }

    return { files: files.length, days, entries };
}
