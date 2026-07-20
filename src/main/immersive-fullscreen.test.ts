import { describe, expect, it, vi } from 'vitest';
import {
  setImmersiveFullscreen,
  setImmersiveFullscreenPriority,
  type ImmersiveFullscreenWindow,
} from './immersive-fullscreen';

function createWindow(initialFullscreen = false): {
  window: ImmersiveFullscreenWindow;
  setFullScreen: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
} {
  let fullscreen = initialFullscreen;
  const setFullScreen = vi.fn((nextFullscreen: boolean) => {
    fullscreen = nextFullscreen;
  });
  const setAlwaysOnTop = vi.fn();
  return {
    window: {
      setFullScreen,
      isFullScreen: () => fullscreen,
      setAlwaysOnTop,
    },
    setFullScreen,
    setAlwaysOnTop,
  };
}

describe('immersive fullscreen window policy', () => {
  it('keeps fullscreen visuals above the Windows taskbar', () => {
    const fixture = createWindow();

    expect(setImmersiveFullscreen(fixture.window, true)).toBe(true);
    expect(fixture.setFullScreen).toHaveBeenCalledWith(true);
    expect(fixture.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
  });

  it('restores ordinary window priority before leaving fullscreen', () => {
    const fixture = createWindow(true);

    expect(setImmersiveFullscreen(fixture.window, false)).toBe(false);
    expect(fixture.setAlwaysOnTop).toHaveBeenCalledWith(false);
    expect(fixture.setFullScreen).toHaveBeenCalledWith(false);
    expect(fixture.setAlwaysOnTop.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.setFullScreen.mock.invocationCallOrder[0],
    );
  });

  it('also restores priority when the operating system leaves fullscreen', () => {
    const fixture = createWindow();

    setImmersiveFullscreenPriority(fixture.window, false);

    expect(fixture.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });
});
