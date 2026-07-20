import { describe, expect, it } from 'vitest';
import { AdaptiveQualityController } from './adaptiveQuality';

describe('adaptive visual quality', () => {
  it('degrades sustained expensive rendering and later recovers gradually', () => {
    const controller = new AdaptiveQualityController();
    for (let index = 0; index < 120; index += 1) controller.record(28, 13.5);
    const degraded = controller.scale;
    expect(degraded).toBeLessThan(1);
    expect(degraded).toBeGreaterThanOrEqual(0.5);

    for (let index = 0; index < 500; index += 1) controller.record(1, 13.5);
    expect(controller.scale).toBeGreaterThan(degraded);
    expect(controller.scale).toBeLessThanOrEqual(1);
  });

  it('degrades when presentation cadence is slow even if JavaScript drawing is cheap', () => {
    const controller = new AdaptiveQualityController();
    for (let index = 0; index < 80; index += 1) {
      controller.record(3, 13.5, 34, 1_000 / 60);
    }
    expect(controller.scale).toBeLessThan(1);
  });
});
