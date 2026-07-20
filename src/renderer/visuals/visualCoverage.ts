export type CanvasVisualVariant = 'compact' | 'immersive';

export function visualGeometryScale(
  variant: CanvasVisualVariant,
  minimumCanvasSize: number,
  bass: number,
  energy: number,
  sectionSpaceDelta: number,
): number {
  return minimumCanvasSize * (
    (variant === 'immersive' ? 0.43 : 0.27)
    + bass * (variant === 'immersive' ? 0.05 : 0.035)
    + energy * (variant === 'immersive' ? 0.04 : 0.025)
    + sectionSpaceDelta * (variant === 'immersive' ? 0.04 : 0.025)
  );
}

export function mixParticleCoverage(
  curveX: number,
  curveY: number,
  normalizedFieldX: number,
  normalizedFieldY: number,
  fieldMix: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const amount = Math.min(1, Math.max(0, fieldMix));
  return {
    x: curveX + (normalizedFieldX * width * 0.5 - curveX) * amount,
    y: curveY + (normalizedFieldY * height * 0.5 - curveY) * amount,
  };
}
