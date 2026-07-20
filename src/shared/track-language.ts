export const TRACK_LANGUAGE_OPTIONS = [
  { value: 'zho', label: '中文' },
  { value: 'eng', label: '英文' },
  { value: 'jpn', label: '日文' },
  { value: 'zxx', label: '纯音乐' },
  { value: 'kor', label: '韩语' },
] as const;

export type TrackLanguage = (typeof TRACK_LANGUAGE_OPTIONS)[number]['value'];

export type WhisperLanguageCode = 'zh' | 'en' | 'ja' | 'ko';

const WHISPER_LANGUAGE_CODES: Readonly<Partial<Record<TrackLanguage, WhisperLanguageCode>>> = {
  zho: 'zh',
  eng: 'en',
  jpn: 'ja',
  kor: 'ko',
};

const TRACK_LANGUAGE_VALUES = new Set<string>(
  TRACK_LANGUAGE_OPTIONS.map((option) => option.value),
);

const LANGUAGE_ALIASES: Readonly<Record<string, TrackLanguage>> = {
  zh: 'zho',
  chi: 'zho',
  zho: 'zho',
  cmn: 'zho',
  en: 'eng',
  eng: 'eng',
  ja: 'jpn',
  jpn: 'jpn',
  ko: 'kor',
  kor: 'kor',
  zxx: 'zxx',
};

export function isTrackLanguage(value: unknown): value is TrackLanguage {
  return typeof value === 'string' && TRACK_LANGUAGE_VALUES.has(value);
}

/**
 * Convert common two/three-letter language values and ID3 TLAN sequences to
 * the single language categories currently supported by the library UI.
 */
export function normalizeTrackLanguage(value: string | null | undefined): TrackLanguage | null {
  const normalized = value?.trim().toLocaleLowerCase();
  if (!normalized) return null;

  for (const part of normalized.split(/[^a-z]+/).filter(Boolean)) {
    const direct = LANGUAGE_ALIASES[part];
    if (direct) return direct;
    for (let offset = 0; offset + 3 <= part.length; offset += 3) {
      const language = LANGUAGE_ALIASES[part.slice(offset, offset + 3)];
      if (language) return language;
    }
  }
  return null;
}

export function getTrackLanguageLabel(language: TrackLanguage | null): string {
  return TRACK_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? '未设置';
}

export function toWhisperLanguageCode(
  language: TrackLanguage | null | undefined,
): WhisperLanguageCode | undefined {
  return language ? WHISPER_LANGUAGE_CODES[language] : undefined;
}
