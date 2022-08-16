import type { Log } from "@ethersproject/providers";
import { readFile, writeFile } from "node:fs/promises";
import path from "path";

import { CONFIG } from "../config";

const { ponderDir } = CONFIG;

type HistoricalLogData = {
  fromBlock: number;
  toBlock: number;
  logs: Log[];
};

type LogCache = { [key: string]: HistoricalLogData | undefined };

const readLogCache = async () => {
  try {
    const rawCache = await readFile(
      path.join(ponderDir, "logCache.json"),
      "utf-8"
    );
    // TODO: Validate cache read from file.
    const cache: LogCache = rawCache ? JSON.parse(rawCache) : {};
    return cache;
  } catch (e) {
    return {};
  }
};

const writeLogCache = async (logCache: LogCache) => {
  await writeFile(
    path.join(ponderDir, "logCache.json"),
    JSON.stringify(logCache),
    "utf-8"
  );
};

export { readLogCache, writeLogCache };
export type { HistoricalLogData, LogCache };