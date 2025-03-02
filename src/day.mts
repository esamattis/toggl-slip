import { format, addDays, startOfWeek } from "date-fns";
import { holidays } from "./holidays.mts";

const PUBLIC_HOLIDAYS: Map<string, string> = new Map(
    holidays.flatMap((holiday) => [[holiday.date, holiday.title]]),
);
export class Day {
    constructor(year: number, month: number, day: number) {
        this.year = year;
        this.month = month;
        this.day = day;
    }

    year: number;
    month: number;
    day: number;

    toString(): string {
        return format(this.toDate(), "yyyy-MM-dd");
    }

    toDate(): Date {
        return new Date(this.year, this.month - 1, this.day);
    }

    nextDay(): Day {
        return Day.from(addDays(this.toDate(), 1));
    }

    dayName(): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun" {
        return format(this.toDate(), "EE") as any;
    }

    publicHoliday(): string | undefined {
        const str = this.toString();
        return PUBLIC_HOLIDAYS.get(str);
    }

    isOff(): boolean {
        return this.isWeekend() || this.publicHoliday() !== undefined;
    }

    type(): string {
        const ph = this.publicHoliday();
        if (ph) return ph;
        if (this.isWeekend()) return "weekend";
        return "workday";
    }

    isWeekend(): boolean {
        const name = this.dayName();
        return name === "Sat" || name === "Sun";
    }

    is(other: Day): boolean {
        return (
            this.year === other.year &&
            this.month === other.month &&
            this.day === other.day
        );
    }

    isAfter(other: Day): boolean {
        return this.toDate().getTime() > other.toDate().getTime();
    }

    static today(): Day {
        return Day.from(new Date());
    }

    static startOfWeek(): Day {
        return Day.from(startOfWeek(new Date(), { weekStartsOn: 1 }));
    }

    static from(date: string | Date): Day {
        if (date instanceof Date) {
            return new Day(
                date.getFullYear(),
                date.getMonth() + 1,
                date.getDate(),
            );
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new Error(`Invalid date string: ${date}`);
        }

        const [year, month, day] = date.split("-").map((s) => Number(s));
        return new Day(year!, month!, day!);
    }
}
