const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function formatDuration(ms: number, workdayDuration: number): string {
    const sign = ms < 0 ? "-" : "";
    let remaining = Math.abs(ms);
    const parts: string[] = [];

    if (workdayDuration > 0 && remaining > workdayDuration) {
        const workdays = Math.floor(remaining / workdayDuration);
        parts.push(`${workdays}wd`);
        remaining %= workdayDuration;
    }

    const hours = Math.floor(remaining / HOUR_MS);
    const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);

    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }

    const text = parts.join(" ") || "0m";
    return text === "0m" ? text : `${sign}${text}`;
}
