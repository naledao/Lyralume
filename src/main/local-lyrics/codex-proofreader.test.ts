// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CodexCliProofreader,
  CodexProofreadError,
  parseCodexProofreadResponse,
  resolveCodexCliCommand,
  type CodexProcessRunner,
  type CodexProofreadInput,
} from './codex-proofreader';

const input: CodexProofreadInput = {
  title: '爱说',
  artist: '咖啡因乐队',
  album: 'REAL',
  language: 'zh',
  offsetMs: 0,
  lines: [
    { id: 'draft-1', startTime: 1, endTime: 3, text: '现在有多遥远', confidence: 0.8, flags: [] },
    { id: 'draft-2', startTime: 3, endTime: 5, text: '生命有多么', confidence: 0.4, flags: ['low_confidence'] },
  ],
};

describe('Codex proofreading response validation', () => {
  it('resolves the npm Codex CLI through node instead of a WindowsApps executable', async () => {
    const cliRoot = await mkdtemp(path.join(tmpdir(), 'lyralume-codex-cli-test-'));
    const codexScript = path.join(cliRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const nodeExecutable = path.join(cliRoot, 'node.exe');
    try {
      await mkdir(path.dirname(codexScript), { recursive: true });
      await Promise.all([
        writeFile(path.join(cliRoot, 'codex.cmd'), '@echo off'),
        writeFile(nodeExecutable, ''),
        writeFile(codexScript, ''),
      ]);

      await expect(resolveCodexCliCommand({
        platform: 'win32',
        pathEnv: cliRoot,
      })).resolves.toEqual({
        executable: nodeExecutable,
        prefixArgs: [codexScript],
      });
    } finally {
      await rm(cliRoot, { recursive: true, force: true });
    }
  });

  it('runs Codex in an isolated read-only non-interactive process', async () => {
    const runner: CodexProcessRunner = vi.fn(async (executable, args, options) => {
      expect(executable).toBe('codex.exe');
      expect(args).toEqual(expect.arrayContaining([
        'exec',
        '--json',
        '--ephemeral',
        '--ignore-user-config',
        '--sandbox',
        'read-only',
        'model_reasoning_effort="max"',
        'web_search="live"',
        '--output-schema',
        '--output-last-message',
      ]));
      expect(options.stdin).toContain('必须先使用联网搜索');
      expect(options.stdin).toContain('"title":"爱说"');
      options.onJsonEvent?.({ type: 'thread.started', thread_id: 'test-thread' });
      options.onJsonEvent?.({
        type: 'item.completed',
        item: {
          id: 'web-1',
          type: 'web_search',
          query: '爱说 咖啡因乐队 REAL 歌词',
          action: { type: 'search', query: '爱说 咖啡因乐队 REAL 歌词' },
        },
      });
      const schemaPath = args[args.indexOf('--output-schema') + 1];
      const outputPath = args[args.indexOf('--output-last-message') + 1];
      const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
      expect(schema.properties.lines).toMatchObject({ minItems: 1, maxItems: 2_000 });
      await writeFile(outputPath, JSON.stringify({
        summary: '无需修改',
        offsetMs: input.offsetMs,
        lines: input.lines.map(({ id, startTime, endTime, text }) => ({
          id,
          startTime,
          endTime,
          text,
        })),
        sources: [{ title: '歌曲资料', url: 'https://example.com/song' }],
      }));
      return { stdout: '', stderr: '' };
    });

    const progress = vi.fn();
    const result = await new CodexCliProofreader('codex.exe', runner, 1_000)
      .proofread(input, undefined, progress);

    expect(result).toMatchObject({
      summary: '无需修改',
      sources: [{ title: '歌曲资料', url: 'https://example.com/song' }],
    });
    expect(progress).toHaveBeenCalledWith({
      stage: 'connected',
      message: 'Codex CLI 会话已建立',
    });
    expect(progress).toHaveBeenCalledWith({
      stage: 'searching',
      message: '联网检索完成',
      detail: '爱说 咖啡因乐队 REAL 歌词',
    });
    expect(progress).toHaveBeenLastCalledWith({
      stage: 'validating',
      message: '正在读取并校验 Codex 结构化结果',
    });
    expect(runner).toHaveBeenCalledOnce();
  });

  it('accepts reordered, split and retimed lyric lines', () => {
    const result = parseCodexProofreadResponse(input, JSON.stringify({
      summary: '拆分并重新计时',
      offsetMs: 500,
      lines: [
        { id: 'codex-1', startTime: 1, endTime: 2, text: '现在有多遥远' },
        { id: 'codex-2', startTime: 2, endTime: 3, text: '生命' },
        { id: 'codex-3', startTime: 3, endTime: 5, text: '有多远' },
      ],
      sources: [{ title: '公开歌词资料', url: 'https://example.com/lyrics' }],
    }));

    expect(result).toEqual({
      summary: '拆分并重新计时',
      offsetMs: 500,
      lines: [
        { id: 'codex-1', startTime: 1, endTime: 2, text: '现在有多遥远' },
        { id: 'codex-2', startTime: 2, endTime: 3, text: '生命' },
        { id: 'codex-3', startTime: 3, endTime: 5, text: '有多远' },
      ],
      sources: [{ title: '公开歌词资料', url: 'https://example.com/lyrics' }],
    });
  });

  it('rejects duplicate identifiers and nonchronological timing', () => {
    expect(() => parseCodexProofreadResponse(input, JSON.stringify({
      summary: '错误结果',
      offsetMs: 0,
      lines: [
        { id: 'duplicate', startTime: 1, endTime: 2, text: '第一行' },
        { id: 'duplicate', startTime: 2, endTime: 3, text: '第二行' },
      ],
      sources: [{ title: '公开来源', url: 'https://example.com/song' }],
    }))).toThrow(CodexProofreadError);

    expect(() => parseCodexProofreadResponse(input, JSON.stringify({
      summary: '错误结果',
      offsetMs: 0,
      lines: [
        { id: 'line-1', startTime: 3, endTime: 4, text: '第一行' },
        { id: 'line-2', startTime: 2, endTime: 3, text: '第二行' },
      ],
      sources: [{ title: '公开来源', url: 'https://example.com/song' }],
    }))).toThrow('时间顺序');
  });

  it('requires a public HTTPS source for every online proofreading result', () => {
    expect(() => parseCodexProofreadResponse(input, JSON.stringify({
      summary: '错误来源',
      offsetMs: 0,
      lines: input.lines.map(({ id, startTime, endTime, text }) => ({ id, startTime, endTime, text })),
      sources: [{ title: '本地页面', url: 'http://localhost/lyrics' }],
    }))).toThrow('非公开的联网来源');
  });
});
