import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_BACKUP_DIR,
  DEFAULT_RETENTION_DAYS,
  backupFileName,
  backupSettingsFromEnv,
  backupTimestamp,
  isBackupFile,
  pruneBackups,
} from '@/modules/backup/service'

/**
 * The nightly dump's *decisions* — naming, recognition, retention — tested
 * without shelling out to `pg_dump`.
 *
 * The dump itself is one `spawn` call and is exercised by running
 * `pnpm db:backup`; what can go quietly wrong is the pruner, because its
 * failure mode is deleting a backup somebody needed, and nobody finds out until
 * the day they need it.
 */

describe('modules/backup — تسمية الملفات', () => {
  it('يبني اسمًا قابلًا للفرز زمنيًا', () => {
    expect(backupFileName(new Date('2026-08-18T02:00:00.000Z'))).toBe(
      'agency-os-2026-08-18T0200.sql.gz',
    )
  })

  it('الأسماء تُرتَّب أبجديًا بترتيبها الزمني', () => {
    const names = [
      backupFileName(new Date('2026-08-18T02:00:00.000Z')),
      backupFileName(new Date('2026-01-02T23:59:00.000Z')),
      backupFileName(new Date('2026-08-18T13:05:00.000Z')),
    ]
    expect([...names].sort()).toEqual([names[1], names[0], names[2]])
  })

  it('يقرأ التاريخ من الاسم لا من زمن التعديل', () => {
    const at = new Date('2026-03-04T05:06:00.000Z')
    expect(backupTimestamp(backupFileName(at))?.toISOString()).toBe(
      '2026-03-04T05:06:00.000Z',
    )
  })

  it('يتعرّف على ملفات النسخ الاحتياطي وحدها', () => {
    expect(isBackupFile('agency-os-2026-08-18T0200.sql.gz')).toBe(true)
    // The half-written file an interrupted run leaves behind.
    expect(isBackupFile('agency-os-2026-08-18T0200.sql.gz.partial')).toBe(false)
    expect(isBackupFile('dump.sql')).toBe(false)
    expect(isBackupFile('agency-os.sql.gz')).toBe(false)
    expect(backupTimestamp('dump.sql')).toBeNull()
  })
})

describe('modules/backup — الإعدادات من البيئة', () => {
  it('يستخدم القيم الافتراضية حين لا تُضبط البيئة', () => {
    const settings = backupSettingsFromEnv({ DATABASE_URL: 'postgres://x/y' })
    expect(settings.directory).toBe(DEFAULT_BACKUP_DIR)
    expect(settings.retentionDays).toBe(DEFAULT_RETENTION_DAYS)
    expect(settings.pgDumpPath).toBe('pg_dump')
  })

  it('يتجاهل مدة احتفاظ غير صالحة بدل تعطيل النسخ', () => {
    for (const value of ['0', '-3', 'abc', '2.5', '']) {
      expect(
        backupSettingsFromEnv({ BACKUP_RETENTION_DAYS: value, DATABASE_URL: 'x' })
          .retentionDays,
      ).toBe(DEFAULT_RETENTION_DAYS)
    }
  })

  it('يقبل مدة احتفاظ صريحة', () => {
    expect(
      backupSettingsFromEnv({ BACKUP_RETENTION_DAYS: '30', DATABASE_URL: 'x' })
        .retentionDays,
    ).toBe(30)
  })
})

describe('modules/backup — التقليم بعد 14 ليلة', () => {
  let directory: string
  const now = new Date('2026-08-18T02:00:00.000Z')

  const dayBefore = (days: number): Date =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agency-backup-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function place(at: Date): Promise<string> {
    const name = backupFileName(at)
    await writeFile(join(directory, name), 'x')
    return name
  }

  it('يحذف ما تجاوز مدة الاحتفاظ ويُبقي ما دونها', async () => {
    const kept = await place(dayBefore(13))
    const boundary = await place(dayBefore(14))
    const stale = await place(dayBefore(15))

    const pruned = await pruneBackups(directory, 14, now)

    expect(pruned).toEqual([stale])
    const remaining = await readdir(directory)
    expect(remaining).toContain(kept)
    // Exactly 14 nights old is *not* older than 14 nights — the boundary is
    // kept, so a fortnight's retention really is a fortnight.
    expect(remaining).toContain(boundary)
    expect(remaining).not.toContain(stale)
  })

  it('لا يمس ملفًا لم يكتبه، مهما كان قديمًا', async () => {
    await writeFile(join(directory, 'notes.txt'), 'x')
    await writeFile(join(directory, 'dump-2020.sql'), 'x')
    // The marker an interrupted dump leaves: never a candidate, so a failed
    // run cannot age out a good backup in its place.
    await writeFile(join(directory, `${backupFileName(dayBefore(40))}.partial`), 'x')

    const pruned = await pruneBackups(directory, 14, now)

    expect(pruned).toEqual([])
    expect((await readdir(directory)).sort()).toHaveLength(3)
  })

  it('لا يفشل حين لا يوجد المجلد بعد', async () => {
    await expect(
      pruneBackups(join(directory, 'does-not-exist'), 14, now),
    ).resolves.toEqual([])
  })

  it('مجلد فارغ لا ينتج حذفًا', async () => {
    await expect(pruneBackups(directory, 14, now)).resolves.toEqual([])
  })
})
