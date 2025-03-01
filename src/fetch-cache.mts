import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import chalk from "chalk";

// Generates a SHA1 hash for the cache key
function generateCacheKey(url: string, body: any): string {
    const key = `${url}:${JSON.stringify(body)}`;
    return crypto.createHash("sha1").update(key).digest("hex");
}

export function clearCache(): Promise<void> {
    const cacheDir = path.resolve(process.cwd(), "cache");
    return fs.rm(cacheDir, { recursive: true, force: true });
}

// Ensures the cache directory exists
async function ensureCacheDirectory(): Promise<string> {
    const cacheDir = path.resolve(process.cwd(), "cache");
    try {
        await fs.access(cacheDir);
    } catch {
        await fs.mkdir(cacheDir, { recursive: true });
    }
    return cacheDir;
}

// Gets the path for a cache file
async function getCachePath(cacheKey: string): Promise<string> {
    const cacheDir = await ensureCacheDirectory();
    return path.join(cacheDir, `${cacheKey}.json`);
}

// Checks if a cached response exists and returns it if valid
async function getCachedResponse(
    cacheKey: string,
): Promise<{ data: any; headers: Record<string, string> } | null> {
    const cachePath = await getCachePath(cacheKey);

    try {
        await fs.access(cachePath);
        const cacheContent = await fs.readFile(cachePath, "utf-8");
        return JSON.parse(cacheContent);
    } catch (err) {
        // File doesn't exist or can't be read
        return null;
    }
}

// Saves a response to the cache
async function saveResponseToCache(
    cacheKey: string,
    data: any,
    headers: Record<string, string>,
): Promise<void> {
    const cachePath = await getCachePath(cacheKey);
    const cacheContent = JSON.stringify({ data, headers }, null, 2);

    try {
        await fs.writeFile(cachePath, cacheContent, "utf-8");
    } catch (err) {
        console.warn(
            chalk.red(`Failed to write to cache file: ${cachePath}`),
            err,
        );
    }
}

// Main fetch function with caching
export async function fetchWithCache(
    url: string,
    options: RequestInit,
    requestBody: any,
): Promise<{ data: any; headers: Record<string, string> }> {
    const cacheKey = generateCacheKey(url, requestBody);
    const cachedResponse = await getCachedResponse(cacheKey);

    if (cachedResponse) {
        console.log(
            chalk.blue(`Using cached response for ${url}`),
            JSON.stringify(requestBody),
        );
        return cachedResponse;
    }

    console.log(
        chalk.yellow(`Fetching fresh data from ${url}`),
        JSON.stringify(requestBody),
    );
    const response = await fetch(url, options);

    if (!response.ok) {
        const text = await response.text();
        throw new Error(
            `HTTP error! status: ${response.status}, text: ${text}`,
        );
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
    });

    const data = await response.json();

    // Save response to cache
    await saveResponseToCache(cacheKey, data, responseHeaders);

    return { data, headers: responseHeaders };
}
