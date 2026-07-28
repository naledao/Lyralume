// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { Codex } from '@openai/codex-sdk';
import {
  CodexSdkBilingualTranslator,
  CodexSdkStructuredRunner,
  buildResearchPrompt,
  configuredCodexMcpServerNames,
  isolatedCodexConfig,
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

    startThread() {
      return {
        runStreamed: async () => ({
          events: (async function* events() {
            yield { type: 'item.completed', item: { type: 'agent_message', text: '{}' } };
          }()),
        }),
      };
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
          {
            id: '1.000-0',
            time: 1,
            originalText: 'A secret phrase only present in the local lyrics',
            translatedText: '一句只藏在本地歌词里的秘密话',
          },
          {
            id: '4.000-1',
            time: 4,
            originalText: 'I look into my crystal ball',
            translatedText: '我凝望着我的水晶球',
          },
        ],
      })),
  };
}

describe('Codex bilingual translation', () => {
  it('configures each Codex translation run with max reasoning effort', async () => {
    codexConstructor.mockClear();

    const runner = new CodexSdkStructuredRunner({
      mcpServerNames: ['node_repl', 'windows-mcp'],
    });
    await runner.run({
      prompt: 'test',
      outputSchema: {},
      webSearchMode: 'disabled',
    });

    expect(codexConstructor).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        model_reasoning_effort: 'max',
        features: expect.objectContaining({
          apps: false,
          code_mode: false,
          code_mode_host: false,
          in_app_browser: false,
          plugins: false,
        }),
        mcp_servers: {
          node_repl: { enabled: false },
          'windows-mcp': { enabled: false },
        },
      }),
    }));
  });

  it('discovers MCP server tables and builds quoted disable overrides', () => {
    const names = configuredCodexMcpServerNames(`
[mcp_servers.node_repl]
command = "node_repl.exe"
[mcp_servers.node_repl.env]
TOKEN = "hidden"
[mcp_servers.'remote.server']
url = "https://example.com/mcp"
`);

    expect(names).toEqual(['node_repl', 'remote.server']);
    expect(isolatedCodexConfig(names)).toMatchObject({
      features: { plugins: false, code_mode_host: false },
      mcp_servers: {
        node_repl: { enabled: false },
        '"remote.server"': { enabled: false },
      },
    });
  });

  it('stops a live-web run after the configured idle period while emitting heartbeats', async () => {
    const stalledCodex = {
      startThread: () => ({
        runStreamed: async (_prompt: unknown, options?: { signal?: AbortSignal }) => ({
          events: (async function* stalledEvents() {
            await new Promise<void>((_resolve, reject) => {
              const abort = (): void => reject(options?.signal?.reason);
              if (options?.signal?.aborted) abort();
              else options?.signal?.addEventListener('abort', abort, { once: true });
            });
          }()),
        }),
      }),
    } as unknown as Codex;
    const heartbeat = vi.fn();
    const runner = new CodexSdkStructuredRunner({
      codex: stalledCodex,
      heartbeatIntervalMs: 10,
      timeoutMs: 1_000,
    });

    await expect(runner.run({
      prompt: 'research',
      outputSchema: {},
      webSearchMode: 'live',
      idleTimeoutMs: 60,
      idleTimeoutMessage: '联网研究空闲超时',
      onHeartbeat: heartbeat,
    })).rejects.toMatchObject({
      code: 'failed',
      message: '联网研究空闲超时',
    });
    expect(heartbeat).toHaveBeenCalled();
  });

  it('resolves the packaged Windows CLI from the physical app.asar.unpacked directory', () => {
    const runtime = resolvePackagedCodexRuntime('C:\\Program Files\\Lyralume\\resources', {
      platform: 'win32',
      arch: 'x64',
      environment: {
        Path: 'C:\\Windows\\System32',
        PROXY_URL: 'http://127.0.0.1:7897',
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
    expect(runtime.env.HTTP_PROXY).toBe('http://127.0.0.1:7897');
    expect(runtime.env.HTTPS_PROXY).toBe('http://127.0.0.1:7897');
    expect(runtime.env.ALL_PROXY).toBe('http://127.0.0.1:7897');
  });

  it('keeps lyrics out of the live-web stage and returns the Codex draft', async () => {
    const runner = successfulRunner();
    const result = await new CodexSdkBilingualTranslator(runner).translate(input);

    expect(result).toEqual({
      summary: '保留轻盈语气和水晶球意象。',
      lines: [
        {
          id: '1.000-0',
          time: 1,
          originalText: 'A secret phrase only present in the local lyrics',
          translatedText: '一句只藏在本地歌词里的秘密话',
        },
        {
          id: '4.000-1',
          time: 4,
          originalText: 'I look into my crystal ball',
          translatedText: '我凝望着我的水晶球',
        },
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
    expect(prompt).toContain('只允许使用 Codex 内置 Web Search');
    expect(prompt).not.toContain('公开 HTTPS');
    expect(prompt).not.toContain('A secret phrase only present in the local lyrics');
    expect(prompt).not.toContain('I look into my crystal ball');
  });

  it('accepts Codex changes to identifiers, order, timing, line count and blank structure', async () => {
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
        summary: '按语义重排草稿',
        lines: [
          {
            id: 'codex-blank',
            time: 0.5,
            originalText: '',
            translatedText: '（前奏）',
          },
          {
            id: '4.000-1',
            time: 4.25,
            originalText: 'I look into my crystal ball',
            translatedText: '第二行',
          },
          {
            id: 'codex-new',
            time: 1.5,
            originalText: 'A secret phrase',
            translatedText: '',
          },
        ],
      }));

    await expect(new CodexSdkBilingualTranslator(runner).translate(input))
      .resolves.toMatchObject({
        summary: '按语义重排草稿',
        lines: [
          { id: 'codex-blank', time: 0.5, originalText: '', translatedText: '（前奏）' },
          { id: '4.000-1', time: 4.25, originalText: 'I look into my crystal ball', translatedText: '第二行' },
          { id: 'codex-new', time: 1.5, originalText: 'A secret phrase', translatedText: '' },
        ],
      });
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
          { id: '1.000-0', time: 1, originalText: input.lines[0].text, translatedText: '第一行' },
          { id: '4.000-1', time: 4, originalText: input.lines[1].text, translatedText: '第二行' },
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
