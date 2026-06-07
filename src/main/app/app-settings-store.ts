import * as fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const retentionDaysSchema = z.union([z.literal(3), z.literal(7), z.literal(30)]);
export type RetentionDays = z.infer<typeof retentionDaysSchema>;

export interface AppSettings {
  retentionDays: RetentionDays;
}

export interface AppSettingsStore {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
}

const DEFAULT_APP_SETTINGS = {
  retentionDays: 7
} satisfies AppSettings;

const appSettingsFileSchema = z
  .object({
    version: z.literal(1),
    settings: z
      .object({
        retentionDays: retentionDaysSchema
      })
      .strict()
  })
  .strict();

export class FileBackedAppSettingsStore implements AppSettingsStore {
  readonly #filePath: string;

  constructor(appDataDir: string) {
    this.#filePath = path.join(appDataDir, "app-settings.json");
  }

  async load(): Promise<AppSettings> {
    try {
      const source = await fs.readFile(this.#filePath, "utf8");
      const parsed = safeParseAppSettingsFile(source);

      if (!parsed.success) {
        return { ...DEFAULT_APP_SETTINGS };
      }

      return parsed.data.settings;
    } catch (error) {
      if (isMissingFileError(error) || error instanceof SyntaxError) {
        return { ...DEFAULT_APP_SETTINGS };
      }

      throw error;
    }
  }

  async save(settings: AppSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    const payload = appSettingsFileSchema.parse({
      version: 1,
      settings
    });
    const tempPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, this.#filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

export function calculateRetentionCutoffIso(
  retentionDays: RetentionDays,
  now = new Date()
): string {
  const cutoff = new Date(now.getTime());

  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff.toISOString();
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function safeParseAppSettingsFile(source: string) {
  try {
    return appSettingsFileSchema.safeParse(JSON.parse(source));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false as const,
        error
      };
    }

    throw error;
  }
}
