import { useEffect, useState } from 'react';
import {
  extractArtworkParticleField,
  type ArtworkParticleField,
} from './artworkParticleField';

const SAMPLE_SIZE = 64;
const fieldCache = new Map<string, Promise<ArtworkParticleField | null>>();

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

async function readArtworkParticleField(source: string): Promise<ArtworkParticleField | null> {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Artwork particle canvas is unavailable');
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return extractArtworkParticleField(
    context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data,
    SAMPLE_SIZE,
    SAMPLE_SIZE,
  );
}

function getCachedArtworkParticleField(source: string): Promise<ArtworkParticleField | null> {
  const existing = fieldCache.get(source);
  if (existing) return existing;
  const pending = readArtworkParticleField(source);
  fieldCache.set(source, pending);
  void pending.catch(() => fieldCache.delete(source));
  return pending;
}

export function useArtworkParticleField(
  source: string | undefined,
): ArtworkParticleField | null {
  const [field, setField] = useState<ArtworkParticleField | null>(null);

  useEffect(() => {
    let active = true;
    setField(null);
    if (!source) return () => { active = false; };
    void getCachedArtworkParticleField(source)
      .then((nextField) => {
        if (active) setField(nextField);
      })
      .catch(() => {
        if (active) setField(null);
      });
    return () => { active = false; };
  }, [source]);

  return field;
}
