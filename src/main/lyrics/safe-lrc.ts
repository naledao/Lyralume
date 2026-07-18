import { randomUUID } from 'node:crypto';
import { link, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseLrc } from '../../shared/lrc.js';

export class LrcSaveError extends Error {
  constructor(
    readonly kind: 'existing' | 'invalid' | 'write',
    message: string,
  ) {
    super(message);
    this.name = 'LrcSaveError';
  }
}

export function sidecarLrcPath(audioPath: string): string {
  const parsed = path.parse(audioPath);
  return path.join(parsed.dir, `${parsed.name}.lrc`);
}

function normalizedLrc(raw: string): string {
  const withoutBom = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd();
  return `${withoutBom}\n`;
}

export async function saveLrcAtomically(
  audioPath: string,
  raw: string,
  overwriteExisting = false,
): Promise<string> {
  if (parseLrc(raw).lines.length === 0) {
    throw new LrcSaveError('invalid', '候选歌词不包含有效的同步时间戳');
  }

  const targetPath = sidecarLrcPath(audioPath);
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(normalizedLrc(raw), 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;

    if (overwriteExisting) {
      await rename(temporaryPath, targetPath);
    } else {
      try {
        await link(temporaryPath, targetPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new LrcSaveError('existing', '歌曲旁已存在同名 LRC，需要明确确认后才能覆盖');
        }
        throw error;
      }
      await rm(temporaryPath, { force: true });
    }
    return targetPath;
  } catch (error) {
    if (error instanceof LrcSaveError) throw error;
    throw new LrcSaveError(
      'write',
      error instanceof Error ? `LRC 保存失败：${error.message}` : 'LRC 保存失败',
    );
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
