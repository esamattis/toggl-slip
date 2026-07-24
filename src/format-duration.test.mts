import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration } from "./format-duration.mts";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const WORKDAY_MS = 7.5 * HOUR_MS;

test("formats durations up to one workday as hours and minutes", () => {
    assert.equal(formatDuration(0, WORKDAY_MS), "0m");
    assert.equal(formatDuration(44 * MINUTE_MS, WORKDAY_MS), "44m");
    assert.equal(formatDuration(4 * HOUR_MS, WORKDAY_MS), "4h");
    assert.equal(
        formatDuration(7 * HOUR_MS + 29 * MINUTE_MS, WORKDAY_MS),
        "7h 29m",
    );
    assert.equal(formatDuration(WORKDAY_MS, WORKDAY_MS), "7h 30m");
});

test("formats durations over one workday with wd", () => {
    assert.equal(
        formatDuration(
            3 * WORKDAY_MS + 4 * HOUR_MS + 44 * MINUTE_MS,
            WORKDAY_MS,
        ),
        "3wd 4h 44m",
    );
});

test("formats negative workday durations with one leading sign", () => {
    assert.equal(
        formatDuration(
            -(2 * WORKDAY_MS + 3 * HOUR_MS + 12 * MINUTE_MS),
            WORKDAY_MS,
        ),
        "-2wd 3h 12m",
    );
    assert.equal(formatDuration(-30 * 1000, WORKDAY_MS), "0m");
});

test("falls back to hours and minutes without a valid workday duration", () => {
    assert.equal(
        formatDuration(25 * HOUR_MS + 10 * MINUTE_MS, 0),
        "25h 10m",
    );
});
