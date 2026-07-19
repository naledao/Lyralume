export class TrackWriteBusyError extends Error {
  constructor() {
    super('这首歌曲已有文件写入任务正在运行');
    this.name = 'TrackWriteBusyError';
  }
}

export class TrackWriteCoordinator {
  private readonly activeTrackIds = new Set<string>();

  isBusy(trackId: string): boolean {
    return this.activeTrackIds.has(trackId);
  }

  async run<T>(trackId: string, operation: () => Promise<T>): Promise<T> {
    if (this.activeTrackIds.has(trackId)) throw new TrackWriteBusyError();
    this.activeTrackIds.add(trackId);
    try {
      return await operation();
    } finally {
      this.activeTrackIds.delete(trackId);
    }
  }
}
