import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCsvFiles } from "./csv-loader.mts";
import { openDatabase, readHoursByDay } from "./database.mts";

const HEADER =
    '"Description","Duration","Member","Email","Project","Tags","Start date","Start time","Stop date","Stop time"\n';

test("CSV loads replace complete days and SQL queries filter entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "toggl-hour-slip-"));
    const first = join(directory, "first.csv");
    const second = join(directory, "second.csv");
    const replacement = join(directory, "replacement.csv");
    const database = openDatabase(":memory:");

    await writeFile(
        first,
        HEADER +
            '"work, planning","1:00:00","A","a@example.com","Alpha","tag","2026-01-05","09:00:00","2026-01-05","10:00:00"\n' +
            '"Vacation","2:00:00","A","a@example.com","-","-","2026-01-05","10:00:00","2026-01-05","12:00:00"\n' +
            '"Vacation","2:00:00","A","a@example.com","-","-","2026-01-05","10:00:00","2026-01-05","12:00:00"\n' +
            '"Zero","-","A","a@example.com","-","-","2026-01-05","12:00:00","2026-01-05","12:00:00"\n',
    );
    await writeFile(
        second,
        HEADER +
            '"Review ""thing""","0:30:00","A","a@example.com","Beta","-","2026-01-06","09:00:00","2026-01-06","09:30:00"\n',
    );
    await writeFile(
        replacement,
        HEADER +
            '"Replacement","0:15:00","A","a@example.com","-","-","2026-01-05","09:00:00","2026-01-05","09:15:00"\n',
    );

    try {
        assert.deepEqual(loadCsvFiles(database, [first, second]), {
            files: 2,
            days: 2,
            entries: 5,
        });
        loadCsvFiles(database, [first, second]);

        assert.deepEqual(
            readHoursByDay(database, {
                start: "2026-01-05",
                end: "2026-01-06",
                projects: true,
            }),
            [
                {
                    day: "2026-01-05",
                    ms: 18_000_000,
                    descriptions: [
                        "[Alpha] work, planning",
                        "Vacation",
                        "Vacation",
                        "Zero",
                    ],
                    matchesFilter: true,
                },
                {
                    day: "2026-01-06",
                    ms: 1_800_000,
                    descriptions: ['[Beta] Review "thing"'],
                    matchesFilter: true,
                },
            ],
        );

        assert.deepEqual(
            readHoursByDay(database, {
                start: "2026-01-05",
                end: "2026-01-06",
                exclude: "VACATION",
                filter: "work",
                projects: true,
            }),
            [
                {
                    day: "2026-01-05",
                    ms: 3_600_000,
                    descriptions: ["[Alpha] work, planning", "Zero"],
                    matchesFilter: true,
                },
                {
                    day: "2026-01-06",
                    ms: 1_800_000,
                    descriptions: ['[Beta] Review "thing"'],
                    matchesFilter: false,
                },
            ],
        );

        loadCsvFiles(database, [replacement]);
        assert.deepEqual(
            readHoursByDay(database, {
                start: "2026-01-05",
                end: "2026-01-06",
                projects: false,
            }).map(({ day, ms }) => ({ day, ms })),
            [
                { day: "2026-01-05", ms: 900_000 },
                { day: "2026-01-06", ms: 1_800_000 },
            ],
        );
    } finally {
        database.close();
        await rm(directory, { recursive: true, force: true });
    }
});
