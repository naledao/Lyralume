import { useEffect, useState } from 'react';
import {
  DEFAULT_ARTWORK_PALETTE,
  extractArtworkPalette,
  type ArtworkPalette,
} from './artworkPalette';

const SAMPLE_SIZE = 64;
const paletteCache = new Map<string, Promise<ArtworkPalette>>();

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('Artwork could not be decoded')), {
      once: true,
    });
    image.src = source;
  });
}

async function readArtworkPalette(source: string): Promise<ArtworkPalette> {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Artwork palette canvas is unavailable');
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return extractArtworkPalette(
    context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data,
  );
}

function getCachedArtworkPalette(source: string): Promise<ArtworkPalette> {
  const existing = paletteCache.get(source);
  if (existing) return existing;
  const pending = readArtworkPalette(source);
  paletteCache.set(source, pending);
  void pending.catch(() => paletteCache.delete(source));
  return pending;
}

export function useArtworkPalette(source: string | undefined): ArtworkPalette {
  const [palette, setPalette] = useState<ArtworkPalette>(DEFAULT_ARTWORK_PALETTE);

  useEffect(() => {
    let active = true;
    if (!source) {
      setPalette(DEFAULT_ARTWORK_PALETTE);
      return () => { active = false; };
    }
    void getCachedArtworkPalette(source)
      .then((nextPalette) => {
        if (active) setPalette(nextPalette);
      })
      .catch(() => {
        if (active) setPalette(DEFAULT_ARTWORK_PALETTE);
      });
    return () => { active = false; };
  }, [source]);

  return palette;
}
