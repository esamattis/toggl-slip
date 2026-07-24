import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Day } from "./day.mts";
import { openDatabase, replaceDayEntries } from "./database.mts";
import { html } from "./html.mts";
import { createReportServer } from "./report-server.mts";
import { createHoursTable, type HoursOptions } from "./report-table.mts";

function hoursOptions(): HoursOptions {
    return {
        start: Day.from("2026-07-14"),
        end: Day.from("2026-07-14"),
        exclude: undefined,
        filter: undefined,
        target: 7.5 * 60 * 60 * 1000,
        all: false,
        links: false,
        last: undefined,
        projects: false,
        includeCurrentDay: true,
        initialHours: 0,
    };
}

test("html templates escape values and compose generated markup", () => {
    const name = "<Matti & Maija>";
    const greeting = html`<strong>Hello</strong>`;
    assert.equal(
        html`<div>${greeting}, ${name}</div>`.value,
        "<div><strong>Hello</strong>, &lt;Matti &amp; Maija&gt;</div>",
    );
});

test("daily hours table can be rendered through the HTTP server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "toggl-hour-slip-server-"));
    const databasePath = join(directory, "report.sqlite3");
    const database = openDatabase(databasePath);
    try {
        replaceDayEntries(database, "2026-07-14", [
            {
                day: "2026-07-14",
                description: "Client <script>alert('no')</script> & support",
                durationSeconds: 8 * 60 * 60,
                member: "A",
                email: "a@example.com",
                project: null,
                tags: null,
                startTime: "09:00:00",
                stopDate: "2026-07-14",
                stopTime: "17:00:00",
            },
        ]);

        const table = createHoursTable(database, hoursOptions(), {
            decimal: false,
        });
        assert.deepEqual(
            table.columns.map((column) => column.title),
            ["Date", "Hours", "Slip", "Total Slip", "Type", "Day", "Description"],
        );
        assert.equal(table.rows[0]?.cells.hours?.text, "8h");
        assert.equal(table.rows[0]?.cells.hours?.style, "positive");
        assert.equal(table.summary.totalSlip.text, "30m");
    } finally {
        database.close();
    }

    const server = createReportServer({
        databasePath,
        hours: {
            ...hoursOptions(),
            start: Day.from("2026-07-13"),
        },
        decimal: false,
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        assert.ok(address && typeof address === "object");

        const response = await fetch(`http://127.0.0.1:${address.port}/`);
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type") ?? "", /text\/html/);
        assert.match(body, /<style>/);
        assert.match(body, /color-scheme: dark/);
        assert.match(body, /position: sticky/);
        assert.match(body, /Daily hours/);
        assert.match(body, /Client &lt;script&gt;alert\(&#39;no&#39;\)&lt;\/script&gt; &amp; support/);
        assert.doesNotMatch(body, /Client <script>/);
        assert.ok(
            body.indexOf("<span>2026-07-14</span>") <
                body.indexOf('<span class="danger">2026-07-13</span>'),
        );

        const missing = await fetch(
            `http://127.0.0.1:${address.port}/missing`,
        );
        assert.equal(missing.status, 404);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
        await rm(directory, { recursive: true, force: true });
    }
});
