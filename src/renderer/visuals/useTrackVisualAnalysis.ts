import { useEffect, useState } from 'react';
import type { TrackVisualAnalysis } from '../../shared/visual-analysis';

export function useTrackVisualAnalysis(trackId: string | null): TrackVisualAnalysis | undefined {
  const [analysis, setAnalysis] = useState<TrackVisualAnalysis>();

  useEffect(() => {
    let disposed = false;
    setAnalysis(undefined);
    if (!trackId) return;
    void window.lyralume.visuals.getAnalysis(trackId).then((result) => {
      if (!disposed && result.trackId === trackId) setAnalysis(result);
    }).catch(() => {
      // Real-time visual analysis remains available when whole-track analysis fails.
    });
    const unsubscribe = window.lyralume.visuals.onAnalysisChanged((result) => {
      if (!disposed && result.trackId === trackId) setAnalysis(result);
    });
    const unsubscribeProgress = window.lyralume.visuals.onAnalysisProgress((progress) => {
      if (!disposed && progress.trackId === trackId) {
        setAnalysis((current) => current ? {
          ...current,
          status: progress.status,
          progress: progress.progress,
          error: progress.status === 'failed' ? progress.message : current.error,
        } : current);
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeProgress();
    };
  }, [trackId]);

  return analysis;
}
