import { useCallback, useEffect, useState } from 'react';

interface ImmersiveFullscreenState {
  active: boolean;
  error: string | null;
  enter(): Promise<void>;
  exit(): Promise<void>;
}

export function useImmersiveFullscreen(): ImmersiveFullscreenState {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return window.lyralume.app.onFullscreenChanged((fullscreen) => {
      setActive(fullscreen);
      if (fullscreen) setError(null);
    });
  }, []);

  const enter = useCallback(async (): Promise<void> => {
    setError(null);
    setActive(true);
    try {
      const fullscreen = await window.lyralume.app.setFullscreen(true);
      setActive(fullscreen);
      if (!fullscreen) setError('Windows 未能进入全屏模式，请重试。');
    } catch (requestError) {
      setActive(false);
      setError(requestError instanceof Error
        ? `无法进入全屏：${requestError.message}`
        : 'Windows 未能进入全屏模式，请重试。');
    }
  }, []);

  const exit = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const fullscreen = await window.lyralume.app.setFullscreen(false);
      setActive(fullscreen);
      if (fullscreen) setError('Windows 未能退出全屏模式，请重试。');
    } catch (exitError) {
      setError(exitError instanceof Error
        ? `无法退出全屏：${exitError.message}`
        : 'Windows 未能退出全屏模式，请按 Esc 重试。');
    }
  }, []);

  return { active, error, enter, exit };
}
