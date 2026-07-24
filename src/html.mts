export interface Html {
    readonly value: string;
}

type HtmlValue = Html | string | number | null | undefined | HtmlValue[];

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function renderValue(value: HtmlValue): string {
    if (Array.isArray(value)) return value.map(renderValue).join("");
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return value.value;
    return escapeHtml(String(value));
}

export function html(
    strings: TemplateStringsArray,
    ...values: HtmlValue[]
): Html {
    return {
        value: strings.reduce(
            (output, string, index) =>
                output + string + renderValue(values[index] ?? null),
            "",
        ),
    };
}
