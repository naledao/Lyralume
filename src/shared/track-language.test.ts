import { describe, expect, it } from 'vitest';
import { normalizeTrackLanguage, toWhisperLanguageCode } from './track-language';

describe('normalizeTrackLanguage', () => {
  it.each([
    ['zho', 'zho'],
    ['chi', 'zho'],
    ['zh', 'zho'],
    ['ENG', 'eng'],
    ['ja', 'jpn'],
    ['kor', 'kor'],
    ['zxx', 'zxx'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(normalizeTrackLanguage(input)).toBe(expected);
  });

  it('uses the first supported code in a multi-language TLAN value', () => {
    expect(normalizeTrackLanguage('engzho')).toBe('eng');
  });

  it('ignores unsupported and empty values', () => {
    expect(normalizeTrackLanguage('fra')).toBeNull();
    expect(normalizeTrackLanguage('')).toBeNull();
  });
});

describe('toWhisperLanguageCode', () => {
  it.each([
    ['zho', 'zh'],
    ['eng', 'en'],
    ['jpn', 'ja'],
    ['kor', 'ko'],
  ] as const)('maps library language %s to WhisperX code %s', (input, expected) => {
    expect(toWhisperLanguageCode(input)).toBe(expected);
  });

  it('does not force a speech language for instrumental or unset tracks', () => {
    expect(toWhisperLanguageCode('zxx')).toBeUndefined();
    expect(toWhisperLanguageCode(null)).toBeUndefined();
  });
});
