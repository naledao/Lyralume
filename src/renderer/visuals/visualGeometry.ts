import type { TrackVisualDNA, VisualShapeFamily } from '../../shared/visual-analysis';

export interface VisualPoint {
  x: number;
  y: number;
}

function superformulaRadius(angle: number, symmetry: number): number {
  const cosine = Math.abs(Math.cos((symmetry * angle) / 4));
  const sine = Math.abs(Math.sin((symmetry * angle) / 4));
  return (cosine ** 1.7 + sine ** 1.7) ** (-1 / 3.1);
}

export function sampleVisualShape(
  family: VisualShapeFamily,
  progress: number,
  dna: TrackVisualDNA,
  motion: number,
): VisualPoint {
  const t = ((progress % 1) + 1) % 1;
  const angle = t * Math.PI * 2;
  switch (family) {
    case 'bloom': {
      const radius = superformulaRadius(angle, dna.symmetry) * (0.77 + Math.sin(motion * 0.7) * 0.025);
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }
    case 'spiral': {
      const armProgress = (t * 2) % 1;
      const arm = t < 0.5 ? 0 : Math.PI;
      const spiralAngle = arm + armProgress * Math.PI * (3.2 + dna.symmetry * 0.14) + motion * 0.18;
      const radius = 0.12 + armProgress * 0.9;
      return { x: Math.cos(spiralAngle) * radius, y: Math.sin(spiralAngle) * radius };
    }
    case 'lissajous': {
      const a = 2 + (dna.symmetry % 4);
      const b = a + (dna.symmetry % 2 === 0 ? 1 : 2);
      return {
        x: Math.sin(angle * a + Math.PI / 2 + motion * 0.06),
        y: Math.sin(angle * b + motion * 0.045) * 0.82,
      };
    }
    case 'flow': {
      const x = t * 2 - 1;
      return {
        x,
        y: Math.sin(x * Math.PI * (1.5 + dna.symmetry * 0.12) + motion * 0.5) * 0.42
          + Math.sin(x * Math.PI * 3.7 - motion * 0.27) * 0.16,
      };
    }
    case 'burst': {
      const ray = Math.floor(t * dna.symmetry * 2);
      const rayProgress = (t * dna.symmetry * 2) % 1;
      const rayAngle = (ray / (dna.symmetry * 2)) * Math.PI * 2;
      const radius = 0.24 + rayProgress * 0.78;
      return { x: Math.cos(rayAngle) * radius, y: Math.sin(rayAngle) * radius };
    }
    case 'constellation': {
      const radius = 0.62 + Math.sin(angle * dna.symmetry + dna.seed * 0.0001) * 0.22;
      const wobble = Math.sin(angle * 3 + motion * 0.08) * 0.08;
      return {
        x: Math.cos(angle + wobble) * radius,
        y: Math.sin(angle - wobble) * radius * 0.78,
      };
    }
    case 'ribbon': {
      const x = t * 2 - 1;
      return {
        x,
        y: Math.sin(angle * 1.5 + motion * 0.22) * 0.48
          + Math.cos(angle * 4 - motion * 0.13) * 0.09,
      };
    }
    case 'orbital':
    default: {
      const radius = 0.82 + Math.sin(angle * dna.symmetry + motion * 0.13) * 0.08;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.72 };
    }
  }
}

export function blendVisualPoints(left: VisualPoint, right: VisualPoint, mix: number): VisualPoint {
  const amount = Math.min(1, Math.max(0, mix));
  return {
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
  };
}

export function sampleVisualDNA(
  dna: TrackVisualDNA,
  progress: number,
  motion: number,
): VisualPoint {
  return blendVisualPoints(
    sampleVisualShape(dna.primaryShape, progress, dna, motion),
    sampleVisualShape(dna.secondaryShape, progress, dna, motion),
    dna.shapeMix,
  );
}
