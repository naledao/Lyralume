export interface ImmersiveFullscreenWindow {
  setFullScreen(fullscreen: boolean): void;
  isFullScreen(): boolean;
  setAlwaysOnTop(alwaysOnTop: boolean, level?: 'screen-saver'): void;
}

/**
 * Windows keeps its auto-hidden taskbar edge above ordinary fullscreen windows
 * after they lose focus. Electron documents the screen-saver level as being
 * above the taskbar, which keeps a secondary-display visual uninterrupted.
 */
export function setImmersiveFullscreenPriority(
  window: ImmersiveFullscreenWindow,
  fullscreen: boolean,
): void {
  if (fullscreen) window.setAlwaysOnTop(true, 'screen-saver');
  else window.setAlwaysOnTop(false);
}

export function setImmersiveFullscreen(
  window: ImmersiveFullscreenWindow,
  fullscreen: boolean,
): boolean {
  if (fullscreen) {
    window.setFullScreen(true);
    setImmersiveFullscreenPriority(window, true);
  } else {
    setImmersiveFullscreenPriority(window, false);
    window.setFullScreen(false);
  }
  return window.isFullScreen();
}
