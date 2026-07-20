import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, PointerEvent } from 'react';
import { seekPlayback } from '../audio/seekPlayback';
import { formatTime } from '../lib/format';

export function PlaybackTimeline({
  className,
  trackId,
  currentTime,
  duration,
}: {
  className: string;
  trackId: string | null;
  currentTime: number;
  duration: number;
}) {
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const draftTimeRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const safeDuration = Math.max(duration, 0);
  const maximum = Math.max(safeDuration, 1);
  const displayTime = Math.min(draftTime ?? currentTime, maximum);

  useEffect(() => {
    draftTimeRef.current = null;
    scrubbingRef.current = false;
    setDraftTime(null);
  }, [trackId]);

  const updateDraft = (value: number): void => {
    const next = Math.min(Math.max(0, value), maximum);
    draftTimeRef.current = next;
    setDraftTime(next);
  };

  const commitDraft = (): void => {
    const value = draftTimeRef.current;
    draftTimeRef.current = null;
    scrubbingRef.current = false;
    setDraftTime(null);
    if (value !== null) seekPlayback(value);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const value = Number(event.target.value);
    if (scrubbingRef.current) {
      updateDraft(value);
    } else {
      seekPlayback(value);
    }
  };

  const beginScrub = (event: PointerEvent<HTMLInputElement>): void => {
    scrubbingRef.current = true;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    updateDraft(Number(event.currentTarget.value));
  };

  const finishScrub = (event: PointerEvent<HTMLInputElement>): void => {
    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) event.currentTarget.releasePointerCapture(event.pointerId);
    commitDraft();
  };

  return (
    <div className={className}>
      <span>{formatTime(displayTime)}</span>
      <input
        type="range"
        min="0"
        max={maximum}
        step="0.05"
        value={displayTime}
        onPointerDown={beginScrub}
        onPointerUp={finishScrub}
        onPointerCancel={finishScrub}
        onBlur={commitDraft}
        onChange={handleChange}
        disabled={!trackId}
        style={{ '--range-progress': `${safeDuration ? (displayTime / safeDuration) * 100 : 0}%` } as CSSProperties}
        aria-label="播放进度"
        aria-valuetext={`${formatTime(displayTime)} / ${formatTime(safeDuration)}`}
      />
      <span>{formatTime(safeDuration)}</span>
    </div>
  );
}
