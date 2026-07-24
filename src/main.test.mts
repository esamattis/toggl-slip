import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function runCli(args: string[], home: string): Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
}> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["src/main.mts", ...args], {
            cwd: process.cwd(),
            env: { ...process.env, HOME: home },
        });
        let stdout = "";
        let stderr = "";

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => (stdout += chunk));
        child.stderr.on("data", (chunk: string) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

test("CLI help lists subcommands and delete removes a complete day", async () => {
    const home = await mkdtemp(join(tmpdir(), "toggl-hour-slip-home-"));
    const csv = join(home, "entries.csv");
    await writeFile(
        csv,
        '"Description","Duration","Member","Email","Project","Tags","Start date","Start time","Stop date","Stop time"\n' +
            '"Work","1:00:00","A","a@example.com","-","-","2026-07-14","09:00:00","2026-07-14","10:00:00"\n' +
            '"More work","0:30:00","A","a@example.com","-","-","2026-07-14","10:00:00","2026-07-14","10:30:00"\n',
    );

    try {
        const help = await runCli(["--help"], home);
        assert.match(help.stdout, /report - Calculate hour slip/);
        assert.match(help.stdout, /load - Replace database entries/);
        assert.match(help.stdout, /delete - Delete all database entries/);

        const deleteHelp = await runCli(["delete", "--help"], home);
        assert.match(deleteHelp.stdout, /<date>/);
        assert.match(deleteHelp.stdout, /YYYY-MM-DD format/);

        const load = await runCli(["load", csv], home);
        assert.equal(load.code, 0, load.stderr);

        const deleted = await runCli(["delete", "2026-07-14"], home);
        assert.equal(deleted.code, 0, deleted.stderr);
        assert.match(deleted.stdout, /Deleted 2 entries for 2026-07-14/);

        const database = new DatabaseSync(
            join(
                home,
                ".local",
                "share",
                "toggl-hour-slip",
                "toggl-hour-slip.sqlite3",
            ),
        );
        try {
            const row = database
                .prepare("SELECT count(*) AS count FROM time_entries")
                .get() as { count: number };
            assert.equal(row.count, 0);
        } finally {
            database.close();
        }

        const deletedAgain = await runCli(["delete", "2026-07-14"], home);
        assert.equal(deletedAgain.code, 0, deletedAgain.stderr);
        assert.match(deletedAgain.stdout, /Deleted 0 entries for 2026-07-14/);

        const invalid = await runCli(["delete", "2026-02-31"], home);
        assert.equal(invalid.code, 1);
        assert.match(invalid.stderr, /Invalid date string: 2026-02-31/);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});
