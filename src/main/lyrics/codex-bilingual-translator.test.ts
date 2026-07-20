// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  CodexBilingualError,
  CodexSdkBilingualTranslator,
  CodexSdkStructuredRunner,
  buildResearchPrompt,
  resolvePackagedCodexRuntime,
  type BilingualTranslationInput,
  type CodexStructuredRunner,
} from './codex-bilingual-translator';

const codexConstructor = vi.hoisted(() => vi.fn());

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(options: unknown) {
      codexConstructor(options);
    }
  },
}));

const input: BilingualTranslationInput = {
  title: 'Crystal Ball',
  artist: 'Lenka',
  album: 'Two',
  style: 'lyrical',
  lines: [
    { id: '1.000-0', time: 1, text: 'A secret phrase only present in the local lyrics' },
    { id: '4.000-1', time: 4, text: 'I look into my crystal ball' },
  ],
};

function successfulRunner(): CodexStructuredRunner {
  return {
    run: vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        tone: '轻盈中带有不确定感',
        narrative: '叙述者试图看清未来',
        imagery: ['水晶球', '朦胧未来'],
        guidance: ['保留疑问语气', '中文保持轻盈'],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: '公开资料强调了对未来的不确定感。',
        notes: [{
          finding: '歌曲围绕无法预知未来的情绪展开。',
          sourceTitle: 'Artist interview',
          sourceUrl: 'https://example.com/interview',
        }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: '保留轻盈语气和水晶球意象。',
        lines: [
          { id: '1.000-0', translatedText: '一句只藏在本地歌词里的秘密话' },
          { id: '4.000-1', translatedText: '我凝望着我的水晶球' },
        ],
      })),
  };
}

describe('Codex bilingual translation', () => {
  it('configures Codex translation with max reasoning effort', () => {
    codexConstructor.mockClear();

    new CodexSdkStructuredRunner();

    expect(codexConstructor).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ model_reasoning_effort: 'max' }),
    }));
  });

  it('resolves the packaged Windows CLI from the physical app.asar.unpacked directory', () => {
    const runtime = resolvePackagedCodexRuntime('C:\\Program Files\\Lyralume\\resources', {
      platform: 'win32',
      arch: 'x64',
      environment: {
        Path: 'C:\\Windows\\System32',
        USERPROFILE: 'C:\\Users\\listener',
      },
    });

    expect(runtime.codexPathOverride).toBe([
      'C:\\Program Files\\Lyralume\\resources',
      'app.asar.unpacked',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe',
    ].join('\\'));
    expect(runtime.codexPathOverride).not.toContain('app.asar\\node_modules');
    expect(runtime.env.Path).toBe([
      'C:\\Program Files\\Lyralume\\resources',
      'app.asar.unpacked',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'codex-path;C:\\Windows\\System32',
    ].join('\\'));
    expect(runtime.env.USERPROFILE).toBe('C:\\Users\\listener');
  });

  it('keeps lyrics out of the live-web stage and validates a one-to-one result', async () => {
    const runner = successfulRunner();
    const result = await new CodexSdkBilingualTranslator(runner).translate(input);

    expect(result).toEqual({
      summary: '保留轻盈语气和水晶球意象。',
      lines: [
        { id: '1.000-0', translatedText: '一句只藏在本地歌词里的秘密话' },
        { id: '4.000-1', translatedText: '我凝望着我的水晶球' },
      ],
      sources: [{ title: 'Artist interview', url: 'https://example.com/interview' }],
    });
    const requests = vi.mocked(runner.run).mock.calls.map(([request]) => request);
    expect(requests.map((request) => request.webSearchMode)).toEqual([
      'disabled',
      'live',
      'disabled',
    ]);
    expect(requests[0].prompt).toContain(input.lines[0].text);
    expect(requests[1].prompt).not.toContain(input.lines[0].text);
    expect(requests[1].prompt).not.toContain(input.lines[1].text);
    expect(requests[2].prompt).toContain(input.lines[0].text);
  });

  it('builds the research request from metadata and fixed goals only', () => {
    const prompt = buildResearchPrompt(input);
    expect(prompt).toContain('Crystal Ball');
    expect(prompt).toContain('创作背景或艺术家访谈');
    expect(prompt).not.toContain('公开 HTTPS');
    expect(prompt).not.toContain('A secret phrase only present in the local lyrics');
    expect(prompt).not.toContain('I look into my crystal ball');
  });

  it('rejects reordered or substituted lyric identifiers', async () => {
    const runner = successfulRunner();
    vi.mocked(runner.run).mockReset()
      .mockResolvedValueOnce(JSON.stringify({
        tone: '轻盈',
        narrative: '看向未来',
        imagery: ['水晶球'],
        guidance: ['自然表达'],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: '背景资料',
        notes: [{
          finding: '主题资料',
          sourceTitle: 'Source',
          sourceUrl: 'https://example.com/source',
        }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: '错误顺序',
        lines: [
          { id: '4.000-1', translatedText: '第二行' },
          { id: '1.000-0', translatedText: '第一行' },
        ],
      }));

    await expect(new CodexSdkBilingualTranslator(runner).translate(input))
      .rejects.toThrow(CodexBilingualError);
  });

  it('accepts empty, non-public, and duplicate research source values', async () => {
    const runner = successfulRunner();
    vi.mocked(runner.run).mockReset()
      .mockResolvedValueOnce(JSON.stringify({
        tone: '轻盈',
        narrative: '看向未来',
        imagery: ['水晶球'],
        guidance: ['自然表达'],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: '背景资料',
        notes: [
          {
            finding: '',
            sourceTitle: '',
            sourceUrl: 'http://127.0.0.1/source',
          },
          {
            finding: '重复来源也保留',
            sourceTitle: 'Local source',
            sourceUrl: 'http://127.0.0.1/source',
          },
        ],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        summary: '完成译配',
        lines: [
          { id: '1.000-0', translatedText: '第一行' },
          { id: '4.000-1', translatedText: '第二行' },
        ],
      }));

    await expect(new CodexSdkBilingualTranslator(runner).translate(input))
      .resolves.toMatchObject({
        sources: [
          { title: '', url: 'http://127.0.0.1/source' },
          { title: 'Local source', url: 'http://127.0.0.1/source' },
        ],
      });
  });

  it('reports a missing packaged executable separately from authentication', async () => {
    const missingExecutable = Object.assign(
      new Error('spawn C:\\app.asar\\node_modules\\codex.exe ENOENT'),
      { code: 'ENOENT' },
    );
    const runner: CodexStructuredRunner = {
      run: vi.fn(async () => Promise.reject(missingExecutable)),
    };

    await expect(new CodexSdkBilingualTranslator(runner).translate(input)).rejects.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('Codex CLI 无法启动或文件缺失'),
    });
    await expect(new CodexSdkBilingualTranslator(runner).translate(input)).rejects.not.toThrow(
      /codex login/i,
    );
  });

  it('keeps a real signed-out response mapped to the login guidance', async () => {
    const runner: CodexStructuredRunner = {
      run: vi.fn(async () => Promise.reject(new Error('Not logged in'))),
    };

    await expect(new CodexSdkBilingualTranslator(runner).translate(input)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'Codex 当前不可用或尚未登录，请先在终端运行 codex login',
    });
  });
});
