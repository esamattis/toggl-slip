import { z } from "zod";
import { fetchWithCache } from "./fetch-cache.mts";
import { Day } from "./day.mts";

// Define the TimeEntry schema
const TimeEntrySchema = z.object({
    id: z.number(),
    seconds: z.number(),
    start: z.string(),
    stop: z.string(),
    at: z.string(),
    at_tz: z.string(),
});

// Define the main schema
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

function basicAuth() {
    const user = process.env.TOGGL_USERNAME;
    const password = process.env.TOGGL_PASSWORD;
    return Buffer.from(`${user}:${password}`).toString("base64");
}

export async function fetchDetailedReport(options: {
    next: string | null;
    start: Day;
    end: Day;
}) {
    const auth = basicAuth();
    const url = `https://api.track.toggl.com/reports/api/v3/workspace/${process.env.TOGGL_WORKSPACE_ID}/search/time_entries`;

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

    const { data: rawData, headers } = await fetchWithCache(
        url,
        fetchOptions,
        requestBody,
    );

    const data = z.array(TogglEntrySchema).parse(rawData);

    return {
        data,
        next: headers["x-next-row-number"] || null,
    };
}

export async function* togglEntries(options: { start: Day; end: Day }) {
    let next: string | null = null;

    while (true) {
        const res = await fetchDetailedReport({
            next: next,
            start: options.start,
            end: options.end,
        });

        for (const entry of res.data) {
            yield entry;
        }

        if (res.next) {
            next = res.next;
        } else {
            break;
        }
    }
}
