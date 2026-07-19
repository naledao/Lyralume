import { randomUUID } from 'node:crypto';
import { open, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LocalLyricsModelSettings } from '../../shared/contracts.js';

const SUPPORTED_UVR_MODEL_EXTENSIONS = new Set(['.ckpt', '.pt', '.pth']);

interface StoredModelSettings {
  version: 1;
  customUvrModelPath: string | null;
}

function isSupportedModelPath(filePath: string): boolean {
  return path.isAbsolute(filePath)
    && !filePath.includes('\0')
    && SUPPORTED_UVR_MODEL_EXTENSIONS.has(path.extname(filePath).toLocaleLowerCase());
}

async function fileAvailable(filePath: string): Promise<boolean> {
  try {
    const details = await stat(filePath);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}

async function writeAtomically(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export class LocalLyricsModelSettingsStore {
  constructor(
    private readonly settingsPath: string,
    private readonly managedModelPath: string,
  ) {}

  async get(): Promise<LocalLyricsModelSettings> {
    const customPath = await this.readCustomPath();
    const modelPath = customPath ?? this.managedModelPath;
    return {
      uvrModelSource: customPath ? 'custom' : 'managed',
      uvrModelPath: modelPath,
      uvrModelName: path.basename(modelPath),
      uvrModelAvailable: await fileAvailable(modelPath),
    };
  }

  async setCustomUvrModel(filePath: string): Promise<LocalLyricsModelSettings> {
    const normalizedPath = path.resolve(filePath);
    if (!isSupportedModelPath(normalizedPath)) {
      throw new Error('请选择 .ckpt、.pt 或 .pth 格式的 UVR 模型文件');
    }
    if (!await fileAvailable(normalizedPath)) {
      throw new Error('所选 UVR 模型不存在、为空或无法读取');
    }
    await this.write({ version: 1, customUvrModelPath: normalizedPath });
    return this.get();
  }

  async resetUvrModel(): Promise<LocalLyricsModelSettings> {
    await this.write({ version: 1, customUvrModelPath: null });
    return this.get();
  }

  private async readCustomPath(): Promise<string | null> {
    try {
      const raw = JSON.parse(await readFile(this.settingsPath, 'utf8')) as Partial<StoredModelSettings>;
      return raw.version === 1
        && typeof raw.customUvrModelPath === 'string'
        && isSupportedModelPath(raw.customUvrModelPath)
        ? path.resolve(raw.customUvrModelPath)
        : null;
    } catch {
      return null;
    }
  }

  private async write(settings: StoredModelSettings): Promise<void> {
    await writeAtomically(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  }
}
