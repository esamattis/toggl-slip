import chalk from "chalk";
import { Table } from "console-table-printer";

import type { CellStyle, TableCell, TableModel } from "./report-table.mts";

function renderCell(cell: TableCell): string {
    const styles: Record<CellStyle, (text: string) => string> = {
        muted: chalk.gray,
        positive: chalk.green,
        negative: chalk.red,
        warning: chalk.yellow,
        danger: chalk.bgRed.white,
        celebration: chalk.bgGreen.white,
    };
    return cell.style ? styles[cell.style](cell.text) : cell.text;
}

export function printTerminalTable(tableModel: TableModel): void {
    const table = new Table({
        columns: tableModel.columns.map((column) => ({
            name: column.key,
            title: column.title,
        })),
    });

    for (const row of tableModel.rows) {
        table.addRow(
            Object.fromEntries(
                tableModel.columns.map((column) => [
                    column.key,
                    renderCell(row.cells[column.key] ?? { text: "" }),
                ]),
            ),
        );
    }
    table.printTable();

    const { totalHours, workedDays, totalSlip } = tableModel.summary;
    console.log(
        `${renderCell(totalHours)} in ${workedDays} days with slip of ${renderCell(totalSlip)}.`,
    );
}
