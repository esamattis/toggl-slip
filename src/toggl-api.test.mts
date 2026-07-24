import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Day } from "./day.mts";
import { togglEntries } from "./toggl-api.mts";

test("paginates report rows within 366-day date windows", async () => {
    const originalDirectory = process.cwd();
    const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), "toggl-hour-slip-"),
    );
    const originalFetch = globalThis.fetch;
    const originalEnvironment = {
        username: process.env.TOGGL_USERNAME,
        password: process.env.TOGGL_PASSWORD,
        workspaceId: process.env.TOGGL_WORKSPACE_ID,
    };
    const requests: unknown[] = [];

    process.chdir(temporaryDirectory);
    process.env.TOGGL_USERNAME = "username";
    process.env.TOGGL_PASSWORD = "password";
    process.env.TOGGL_WORKSPACE_ID = "workspace";
    globalThis.fetch = async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));

        return new Response("[]", {
            status: 200,
            headers:
                requests.length === 1
                    ? { "x-next-row-number": "100" }
                    : undefined,
        });
    };

    try {
        for await (const _entry of togglEntries({
            start: Day.from("2025-03-03"),
            end: Day.from("2026-07-24"),
        })) {
            // Empty mocked responses yield no entries.
        }

        assert.deepEqual(requests, [
            {
                start_date: "2025-03-03",
                end_date: "2026-03-03",
            },
            {
                start_date: "2025-03-03",
                end_date: "2026-03-03",
                first_row_number: 100,
            },
            {
                start_date: "2026-03-04",
                end_date: "2026-07-24",
            },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
        process.chdir(originalDirectory);

        for (const [name, value] of [
            ["TOGGL_USERNAME", originalEnvironment.username],
            ["TOGGL_PASSWORD", originalEnvironment.password],
            ["TOGGL_WORKSPACE_ID", originalEnvironment.workspaceId],
        ] as const) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }

        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});
