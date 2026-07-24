import { html, type Html } from "./html.mts";
import type { TableCell, TableModel } from "./report-table.mts";

function renderCell(cell: TableCell): Html {
    if (cell.href) {
        return cell.style
            ? html`<a class="${cell.style}" href="${cell.href}">${cell.text}</a>`
            : html`<a href="${cell.href}">${cell.text}</a>`;
    }
    return cell.style
        ? html`<span class="${cell.style}">${cell.text}</span>`
        : html`<span>${cell.text}</span>`;
}

export function renderHtmlTable(table: TableModel): string {
    const headers = table.columns.map(
        (column) => html`<th scope="col">${column.title}</th>`,
    );
    const rows = [...table.rows].reverse().map(
        (row) => html`<tr>${table.columns.map(
            (column) =>
                html`<td>${renderCell(row.cells[column.key] ?? { text: "" })}</td>`,
        )}</tr>`,
    );
    const { totalHours, workedDays, totalSlip } = table.summary;

    return html`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${table.title} | Toggl Hour Slip</title>
    <style>
        :root { color-scheme: dark; --bg: #0b0d12; --panel: #131720; --panel-2: #181d28; --line: #2a3140; --text: #e8ecf4; --muted: #8993a5; --green: #67e8a5; --red: #ff7b86; --yellow: #f6c85f; --accent: #8ba7ff; }
        * { box-sizing: border-box; }
        html, body { height: 100%; overflow: hidden; }
        body { margin: 0; min-width: 320px; background: radial-gradient(circle at 15% -10%, #20283a 0, transparent 34rem), var(--bg); color: var(--text); font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        main { display: flex; flex-direction: column; width: min(1500px, calc(100% - 32px)); height: 100dvh; margin: 0 auto; padding: 56px 0 24px; }
        header { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
        h1 { margin: 0; font-size: clamp(2rem, 5vw, 4rem); line-height: .95; letter-spacing: -.055em; }
        .eyebrow { margin: 0 0 10px; color: var(--accent); font: 700 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .16em; text-transform: uppercase; }
        .range { margin: 0; color: var(--muted); font: 500 13px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; }
        .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin-bottom: 18px; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--line); }
        .stat { padding: 18px 20px; background: linear-gradient(145deg, var(--panel-2), var(--panel)); }
        .stat-label { display: block; margin-bottom: 5px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; }
        .stat-value { font: 650 20px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; }
        .table-wrap { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--line); border-radius: 12px; background: rgba(19, 23, 32, .92); box-shadow: 0 24px 80px rgba(0, 0, 0, .28); }
        table { width: 100%; border-collapse: collapse; white-space: nowrap; }
        th { position: sticky; top: 0; z-index: 1; padding: 13px 16px; border-bottom: 1px solid var(--line); background: #171c26; color: var(--muted); font-size: 10px; letter-spacing: .12em; text-align: left; text-transform: uppercase; }
        td { padding: 12px 16px; border-bottom: 1px solid rgba(42, 49, 64, .7); font-variant-numeric: tabular-nums; }
        tbody tr:last-child td { border-bottom: 0; }
        tbody tr:hover td { background: rgba(139, 167, 255, .045); }
        th:nth-child(2), th:nth-child(3), th:nth-child(4), td:nth-child(2), td:nth-child(3), td:nth-child(4) { text-align: right; }
        td:nth-child(-n+4) { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
        a { color: var(--accent); text-decoration: none; }
        a:hover { text-decoration: underline; }
        .muted { color: var(--muted); }
        .positive { color: var(--green); }
        .negative { color: var(--red); }
        .warning { color: var(--yellow); }
        .danger, .celebration { display: inline-block; margin: -3px -7px; padding: 3px 7px; border-radius: 5px; color: #101218; font-weight: 750; }
        .danger { background: var(--red); }
        .celebration { background: var(--green); }
        .empty { padding: 40px 20px; color: var(--muted); text-align: center; }
        footer { margin-top: 14px; color: #636d7e; font-size: 12px; text-align: right; }
        @media (max-width: 700px) { main { width: min(100% - 20px, 1500px); padding: 32px 0 16px; } header { display: block; margin-bottom: 16px; } .range { margin-top: 14px; } .summary { grid-template-columns: 1fr; margin-bottom: 12px; } .stat { padding: 10px 16px; } th, td { padding: 11px 13px; } }
    </style>
</head>
<body>
    <main>
        <header>
            <div><p class="eyebrow">Toggl Hour Slip</p><h1>${table.title}</h1></div>
            <p class="range">${table.subtitle}</p>
        </header>
        <section class="summary" aria-label="Summary">
            <div class="stat"><span class="stat-label">Total hours</span><span class="stat-value">${renderCell(totalHours)}</span></div>
            <div class="stat"><span class="stat-label">Worked days</span><span class="stat-value">${workedDays}</span></div>
            <div class="stat"><span class="stat-label">Total slip</span><span class="stat-value">${renderCell(totalSlip)}</span></div>
        </section>
        <div class="table-wrap">
            <table>
                <thead><tr>${headers}</tr></thead>
                <tbody>${rows.length > 0 ? rows : html`<tr><td class="empty" colspan="${table.columns.length}">No daily hours to show</td></tr>`}</tbody>
            </table>
        </div>
        <footer>Generated ${new Date().toLocaleString()}</footer>
    </main>
</body>
</html>`.value;
}
