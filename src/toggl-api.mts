import { z } from "zod";
import { addDays } from "date-fns";
import { fetchWithCache } from "./fetch-cache.mts";
import { Day } from "./day.mts";

const MAX_REPORT_RANGE_DAYS = 366;

const TimeEntrySchema = z.object({
    id: z.number(),
    seconds: z.number(),
    start: z.string(),
    stop: z.string(),
    at: z.string(),
    at_tz: z.string(),
});

const TogglEntrySchema = z.object({
    user_id: z.number(),
    username: z.string(),
    project_id: z.number().nullish(),
    task_id: z.null().optional(),
    billable: z.boolean(),
    description: z.string(),
    tag_ids: z.array(z.number()),
    billable_amount_in_cents: z.null().optional(),
    hourly_rate_in_cents: z.null().optional(),
    currency: z.string(),
    time_entries: z.array(TimeEntrySchema),
    row_number: z.number(),
});

const ProjectSchema = z.object({
    id: z.number(),
    name: z.string(),
});

function requiredEnv(name: string) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

export async function getProjects() {
    const auth = basicAuth();
    const workspaceId = requiredEnv("TOGGL_WORKSPACE_ID");
    const url = `https://api.track.toggl.com/api/v9/workspaces/${workspaceId}/projects`;

    const { body } = await fetchWithCache(url, {
        method: "GET",
        headers: {
            Authorization: `Basic ${auth}`,
        },
    });

    return ProjectSchema.array().parse(body);
}

function basicAuth() {
    const user = requiredEnv("TOGGL_USERNAME");
    const password = requiredEnv("TOGGL_PASSWORD");
    return Buffer.from(`${user}:${password}`).toString("base64");
}

export async function fetchDetailedReport(options: {
    next: string | null;
    start: Day;
    end: Day;
}) {
    const auth = basicAuth();
    const workspaceId = requiredEnv("TOGGL_WORKSPACE_ID");
    const url = `https://api.track.toggl.com/reports/api/v3/workspace/${workspaceId}/search/time_entries`;

    const requestBody = {
        start_date: options.start.toString(),
        end_date: options.end.toString(),
        first_row_number: options.next ? Number(options.next) : undefined,
    };

    const fetchOptions = {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
    };

    const { body, headers } = await fetchWithCache(
        url,
        fetchOptions,
        requestBody,
    );

    const data = TogglEntrySchema.array().parse(body);

    return {
        data,
        next: headers["x-next-row-number"] || null,
    };
}

export async function* togglEntries(options: { start: Day; end: Day }) {
    let start = options.start;

    while (!start.isAfter(options.end)) {
        const maximumEnd = Day.from(
            addDays(start.toDate(), MAX_REPORT_RANGE_DAYS - 1),
        );
        const end = maximumEnd.isAfter(options.end)
            ? options.end
            : maximumEnd;
        let next: string | null = null;

        while (true) {
            const res = await fetchDetailedReport({
                next,
                start,
                end,
            });

            for (const entry of res.data) {
                yield entry;
            }

            if (!res.next) {
                break;
            }

            next = res.next;
        }

        start = end.nextDay();
    }
}
