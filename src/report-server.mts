import { createServer, type Server } from "node:http";

import { openDatabase } from "./database.mts";
import { renderHtmlTable } from "./html-table.mts";
import { createHoursTable, type HoursOptions } from "./report-table.mts";

export function createReportServer(options: {
    databasePath?: string;
    hours: HoursOptions;
    decimal: boolean;
}): Server {
    return createServer((request, response) => {
        const path = (request.url ?? "/").split("?", 1)[0];
        if (request.method !== "GET" || path !== "/") {
            response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            response.end("Not found\n");
            return;
        }

        let database;
        try {
            database = openDatabase(options.databasePath);
            const html = renderHtmlTable(
                createHoursTable(database, options.hours, {
                    decimal: options.decimal,
                }),
            );
            response.writeHead(200, {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            });
            response.end(html);
        } catch (error) {
            console.error(error);
            response.writeHead(500, {
                "content-type": "text/plain; charset=utf-8",
            });
            response.end("Could not render report\n");
        } finally {
            database?.close();
        }
    });
}
