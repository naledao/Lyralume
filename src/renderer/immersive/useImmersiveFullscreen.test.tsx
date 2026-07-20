import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImmersiveFullscreen } from './useImmersiveFullscreen';

const originalApi = Object.getOwnPropertyDescriptor(window, 'lyralume');
const setFullscreen = vi.fn();
const unsubscribe = vi.fn();
let emitFullscreenChanged: ((fullscreen: boolean) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  emitFullscreenChanged = undefined;
  Object.defineProperty(window, 'lyralume', {
    configurable: true,
    value: {
      app: {
        setFullscreen,
        onFullscreenChanged: (callback: (fullscreen: boolean) => void) => {
          emitFullscreenChanged = callback;
          return unsubscribe;
        },
      },
    },
  });
});

afterEach(() => {
  if (originalApi) Object.defineProperty(window, 'lyralume', originalApi);
  else Reflect.deleteProperty(window, 'lyralume');
});

describe('useImmersiveFullscreen', () => {
  it('uses native window fullscreen and follows main-process state changes', async () => {
    setFullscreen.mockImplementation(async (fullscreen: boolean) => fullscreen);
    const { result, unmount } = renderHook(() => useImmersiveFullscreen());

    await act(() => result.current.enter());
    expect(setFullscreen).toHaveBeenLastCalledWith(true);
    expect(result.current.active).toBe(true);

    act(() => emitFullscreenChanged?.(false));
    expect(result.current.active).toBe(false);

    await act(() => result.current.exit());
    expect(setFullscreen).toHaveBeenLastCalledWith(false);
    expect(result.current.active).toBe(false);

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('returns to the normal layout when native fullscreen is rejected', async () => {
    setFullscreen.mockRejectedValue(new Error('not allowed'));
    const { result } = renderHook(() => useImmersiveFullscreen());

    await act(() => result.current.enter());

    expect(result.current.active).toBe(false);
    expect(result.current.error).toContain('not allowed');
  });
});
