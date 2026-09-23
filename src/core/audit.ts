import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UserError } from '../util/errors.js';
import type { ReleasePlan, ReleaseResult } from './types.js';

/** Her çalıştırmanın izlenebilir kaydı: ne planlandı, ne yapıldı, bildirim gitti mi. */
export interface AuditRecord {
  plan: ReleasePlan;
  result: ReleaseResult;
  notification?: { sentAt?: string; error?: string; skipped?: string };
}

export function writeAudit(logDir: string, record: AuditRecord): string {
  mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, `${record.result.runId}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
}

export function updateAudit(file: string, record: AuditRecord): void {
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export function readAudit(file: string): AuditRecord {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as AuditRecord;
    if (!record.result?.runId) throw new Error('beklenen "result" alanı yok');
    return record;
  } catch (err) {
    throw new UserError(`Log dosyası okunamadı (${file}): ${(err as Error).message}`);
  }
}
