import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

type CacheFile = {
    length: number;
    name: string;
};

const parseZipListing = (zipPath: string): CacheFile[] => {
    const output = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
    const lines = output.split(/\r?\n/);
    const files: CacheFile[] = [];

    for (const line of lines) {
        const match = line.match(/^\s*(\d+)\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/);
        if (!match) {
            continue;
        }
        const length = Number(match[1]);
        const name = match[2].trim();
        if (!name || name.endsWith("/")) {
            continue;
        }
        files.push({ length, name });
    }

    return files;
};

const summarize = (files: CacheFile[]) => {
    const byExt = new Map<string, number>();
    for (const file of files) {
        const ext = path.extname(file.name) || "<none>";
        byExt.set(ext, (byExt.get(ext) ?? 0) + file.length);
    }
    return Array.from(byExt.entries()).sort((a, b) => b[1] - a[1]);
};

const main = () => {
    const zipPath = process.argv[2];
    if (!zipPath) {
        throw new Error("Usage: yarn inspect:osrs-cache -- <cache.zip>");
    }
    const absZip = path.resolve(process.cwd(), zipPath);
    if (!fs.existsSync(absZip)) {
        throw new Error(`Cache zip not found: ${absZip}`);
    }

    const files = parseZipListing(absZip);
    const mainData = files.find((f) => f.name.endsWith("main_file_cache.dat2"));
    const indexes = files.filter((f) => /main_file_cache\.idx\d+$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));

    console.log(JSON.stringify({
        zipPath: absZip,
        fileCount: files.length,
        totalSize: files.reduce((sum, file) => sum + file.length, 0),
        mainDataSize: mainData?.length ?? null,
        indexFiles: indexes.map((f) => ({ name: f.name, length: f.length })),
        byExtension: summarize(files),
    }, null, 2));
};

main();
