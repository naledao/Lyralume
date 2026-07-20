export class AdaptiveQualityController {
  private frameCostAverageMs = 0;
  private frameIntervalAverageMs = 0;
  private expensiveFrameCount = 0;
  private cheapFrameCount = 0;
  scale = 1;

  record(
    frameCostMs: number,
    budgetMs: number,
    frameIntervalMs?: number,
    targetFrameIntervalMs?: number,
  ): number {
    this.frameCostAverageMs = this.frameCostAverageMs * 0.92 + frameCostMs * 0.08;
    if (frameIntervalMs !== undefined) {
      this.frameIntervalAverageMs = this.frameIntervalAverageMs === 0
        ? frameIntervalMs
        : this.frameIntervalAverageMs * 0.92 + frameIntervalMs * 0.08;
    }
    const cadenceIsSlow = targetFrameIntervalMs !== undefined
      && this.frameIntervalAverageMs > targetFrameIntervalMs * 1.22;
    if (this.frameCostAverageMs > budgetMs || cadenceIsSlow) {
      this.expensiveFrameCount += 1;
      this.cheapFrameCount = 0;
    } else if (this.frameCostAverageMs < budgetMs * 0.58) {
      this.cheapFrameCount += 1;
      this.expensiveFrameCount = 0;
    } else {
      this.expensiveFrameCount = 0;
      this.cheapFrameCount = 0;
    }
    if (this.expensiveFrameCount >= 24) {
      this.scale = Math.max(0.5, this.scale - 0.1);
      this.expensiveFrameCount = 0;
    } else if (this.cheapFrameCount >= 180) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.cheapFrameCount = 0;
    }
    return this.scale;
  }
}
