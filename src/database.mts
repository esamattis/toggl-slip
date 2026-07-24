import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface TimeEntry {
    day: string;
    description: string;
    durationSeconds: number;
    member: string;
    email: string;
    project: string | null;
    tags: string | null;
    startTime: string;
    stopDate: string;
    stopTime: string;
}

export interface HoursByDay {
    day: string;
    ms: number;
    descriptions: string[];
    matchesFilter: boolean;
}

export const databaseDirectory = join(
    homedir(),
    ".local",
    "share",
    "toggl-hour-slip",
);
export const databasePath = join(databaseDirectory, "toggl-hour-slip.sqlite3");

export function openDatabase(path = databasePath): DatabaseSync {
    if (path !== ":memory:") {
        mkdirSync(dirname(path), { recursive: true });
    }

    const database = new DatabaseSync(path);
    database.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS time_entries (
            id INTEGER PRIMARY KEY,
            day TEXT NOT NULL,
            description TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
            member TEXT NOT NULL,
            email TEXT NOT NULL,
            project TEXT,
            tags TEXT,
            start_time TEXT NOT NULL,
            stop_date TEXT NOT NULL,
            stop_time TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS time_entries_day_idx ON time_entries(day);
        PRAGMA user_version = 1;
    `);
    return database;
}

export function replaceDayEntries(
    database: DatabaseSync,
    day: string,
    entries: TimeEntry[],
): void {
    if (entries.some((entry) => entry.day !== day)) {
        throw new Error(`Cannot replace ${day} with entries from another day`);
    }

    const remove = database.prepare("DELETE FROM time_entries WHERE day = ?");
    const insert = database.prepare(`
        INSERT INTO time_entries (
            day,
            description,
            duration_seconds,
            member,
            email,
            project,
            tags,
            start_time,
            stop_date,
            stop_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    database.exec("BEGIN IMMEDIATE");
    try {
        remove.run(day);
        for (const entry of entries) {
            insert.run(
                entry.day,
                entry.description,
                entry.durationSeconds,
                entry.member,
                entry.email,
                entry.project,
                entry.tags,
                entry.startTime,
                entry.stopDate,
                entry.stopTime,
            );
        }
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

export function readHoursByDay(
    database: DatabaseSync,
    options: {
        start: string;
        end: string;
        exclude?: string;
        filter?: string;
        projects: boolean;
    },
): HoursByDay[] {
    const exclusions = (options.exclude ?? "")
        .split("|")
        .map((term) => term.trim())
        .filter(Boolean);
    const description = options.projects
        ? "CASE WHEN project IS NULL THEN description ELSE '[' || project || '] ' || description END"
        : "description";
    const exclusionSql = exclusions
        .map(() => "AND instr(lower(display_description), lower(?)) = 0")
        .join("\n");

    const rows = database
        .prepare(
            `
                WITH entries AS (
                    SELECT
                        id,
                        day,
                        duration_seconds,
                        ${description} AS display_description
                    FROM time_entries
                    WHERE day >= ? AND day <= ?
                ), filtered AS (
                    SELECT *
                    FROM entries
                    WHERE 1 = 1
                    ${exclusionSql}
                    ORDER BY id
                )
                SELECT
                    day,
                    sum(duration_seconds) * 1000 AS ms,
                    json_group_array(display_description) AS descriptions,
                    max(instr(display_description, ?) > 0) AS matches_filter
                FROM filtered
                GROUP BY day
                ORDER BY day
            `,
        )
        .all(options.start, options.end, ...exclusions, options.filter ?? "") as Array<{
        day: string;
        ms: number;
        descriptions: string;
        matches_filter: number;
    }>;

    return rows.map((row) => ({
        day: String(row.day),
        ms: Number(row.ms),
        descriptions: JSON.parse(String(row.descriptions)) as string[],
        matchesFilter: options.filter === undefined || Number(row.matches_filter) === 1,
    }));
}
