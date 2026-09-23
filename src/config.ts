import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { UserError } from './util/errors.js';
import { assertTimeZone } from './util/time.js';

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

const envSchema = z.object({
  JIRA_BASE_URL: z.url({ message: 'Geçerli bir URL olmalı (örn. https://sirket.atlassian.net)' }),
  JIRA_EMAIL: z.email({ message: 'Geçerli bir e-posta olmalı' }),
  JIRA_API_TOKEN: z.string().min(1, 'Boş olamaz'),
  TEAMS_WEBHOOK_URL: z.union([z.url(), z.literal('')]).optional(),
  TZ_NAME: z.string().default('Europe/Istanbul'),
  TRIGGERED_BY: z.string().optional(),
  LOG_DIR: z.string().optional(),
});

const projectSchema = z.object({
  displayName: z.string().optional(),
  sourceStatus: z.string().optional(),
  sourceStatusId: z.string().optional(),
  targetStatus: z.string().optional(),
  targetStatusId: z.string().optional(),
  allowedStatuses: z.array(z.string()).optional(),
  transitionFields: z.record(z.string(), z.unknown()).optional(),
  addComment: z.boolean().optional(),
  commentTemplate: z.string().optional(),
  appendTimeToVersionDescription: z.boolean().optional(),
});

const fileSchema = z.object({
  defaults: projectSchema.optional(),
  projects: z.record(z.string(), projectSchema).default({}),
});

export type ConfigFile = z.input<typeof fileSchema>;

export interface ProjectConfig {
  displayName?: string;
  sourceStatus: string;
  sourceStatusId?: string;
  targetStatus: string;
  targetStatusId?: string;
  /**
   * Release'te bulunmasına izin verilen diğer statüler (örn. "Canceled"). Kaynak/hedef statü ve
   * bunlar dışında statüde madde varsa işlem hiç çalıştırılmaz.
   */
  allowedStatuses: string[];
  /** Geçiş ekranındaki zorunlu alanlar için değerler, örn. { "resolution": { "name": "Done" } } */
  transitionFields: Record<string, unknown>;
  addComment: boolean;
  /** Yer tutucular: {date} {time} {version} {project} */
  commentTemplate: string;
  appendTimeToVersionDescription: boolean;
}

const BUILTIN_DEFAULTS: ProjectConfig = {
  sourceStatus: 'To be Deployed',
  targetStatus: 'Completed',
  allowedStatuses: [],
  transitionFields: {},
  addComment: true,
  commentTemplate: 'Bu madde {date} {time} tarihinde {version} sürümü ile canlıya alınmıştır.',
  appendTimeToVersionDescription: true,
};

export interface AppConfig {
  jira: { baseUrl: string; email: string; apiToken: string };
  teams: { webhookUrl?: string };
  timeZone: string;
  triggeredBy: string;
  logDir: string;
  /** Config dosyasında tanımlı proje anahtarları */
  projectKeys: string[];
  /** Proje ayarı; dosyada olmayan projeler için varsayılanlar kullanılır. */
  project(key: string): ProjectConfig;
}

function formatZodError(prefix: string, err: z.ZodError): UserError {
  const lines = err.issues.map((i) => `  - ${i.path.join('.') || '(kök)'}: ${i.message}`);
  return new UserError(`${prefix}\n${lines.join('\n')}`);
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createConfig(env: Record<string, string | undefined>, file: ConfigFile): AppConfig {
  const envResult = envSchema.safeParse(env);
  if (!envResult.success) {
    throw formatZodError('.env ayarları hatalı veya eksik (.env.example dosyasına bakın):', envResult.error);
  }
  const fileResult = fileSchema.safeParse(file);
  if (!fileResult.success) {
    throw formatZodError('config/releases.config.json hatalı:', fileResult.error);
  }
  const e = envResult.data;
  const f = fileResult.data;
  assertTimeZone(e.TZ_NAME);

  const defaults: ProjectConfig = { ...BUILTIN_DEFAULTS, ...stripUndefined(f.defaults ?? {}) };
  const projects = new Map(Object.entries(f.projects).map(([k, v]) => [k.toUpperCase(), v]));

  return {
    jira: { baseUrl: e.JIRA_BASE_URL.replace(/\/+$/, ''), email: e.JIRA_EMAIL, apiToken: e.JIRA_API_TOKEN },
    teams: { webhookUrl: e.TEAMS_WEBHOOK_URL || undefined },
    timeZone: e.TZ_NAME,
    triggeredBy: e.TRIGGERED_BY?.trim() || os.userInfo().username,
    logDir: path.resolve(PROJECT_ROOT, e.LOG_DIR ?? 'logs'),
    projectKeys: [...projects.keys()],
    project(key: string): ProjectConfig {
      const own = projects.get(key.toUpperCase()) ?? {};
      return { ...defaults, ...stripUndefined(own) };
    },
  };
}

export function loadConfig(): AppConfig {
  loadDotenv({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
  const configPath = path.resolve(PROJECT_ROOT, process.env.CONFIG_PATH ?? 'config/releases.config.json');
  let file: ConfigFile = { projects: {} };
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, 'utf8')) as ConfigFile;
    } catch (err) {
      throw new UserError(`${configPath} okunamadı: ${(err as Error).message}`);
    }
  }
  return createConfig(process.env, file);
}
