import { Notification, type BrowserWindow } from 'electron';
import type { BilingualLyricsTask, LocalLyricsTask } from '../shared/contracts.js';
import { IPC_CHANNELS } from '../shared/contracts.js';
import type { LibraryDatabase } from './library/database.js';
import {
  bilingualTaskCompletionNotification,
  localTaskCompletionNotification,
  type TaskCompletionNotification,
} from './task-notification-events.js';

export class TaskNotificationService {
  private readonly announced = new Set<string>();
  private readonly visible = new Set<Notification>();

  constructor(
    private readonly database: Pick<LibraryDatabase, 'getTrackLocation'>,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  handleLocal(task: LocalLyricsTask): void {
    const trackTitle = this.database.getTrackLocation(task.trackId)?.title;
    if (!trackTitle) return;
    this.show(localTaskCompletionNotification(task, trackTitle));
  }

  handleBilingual(task: BilingualLyricsTask): void {
    const trackTitle = this.database.getTrackLocation(task.trackId)?.title;
    if (!trackTitle) return;
    this.show(bilingualTaskCompletionNotification(task, trackTitle));
  }

  private show(event: TaskCompletionNotification | null): void {
    if (!event || this.announced.has(event.key) || !Notification.isSupported()) return;
    this.announced.add(event.key);

    const notification = new Notification({
      title: event.title,
      body: event.body,
      silent: false,
    });
    this.visible.add(notification);
    notification.on('click', () => {
      const window = this.getWindow();
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      if (window.isFullScreen()) window.setFullScreen(false);
      if (!window.isVisible()) window.show();
      window.focus();
      if (!window.webContents.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.appOpenTask, event.target);
      }
    });
    notification.once('close', () => this.visible.delete(notification));
    notification.show();
  }
}
