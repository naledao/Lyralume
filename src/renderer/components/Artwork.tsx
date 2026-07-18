import type { Track } from '../../shared/contracts';
import { Icon } from './Icon';

export function Artwork({ track, className = '' }: { track: Track | null; className?: string }) {
  if (track?.artworkUrl) {
    return <img className={`artwork ${className}`} src={track.artworkUrl} alt={`${track.album} 封面`} />;
  }
  return (
    <div className={`artwork artwork--placeholder ${className}`} aria-label="默认专辑封面">
      <Icon name="music" />
      <span>{track?.title.slice(0, 1).toLocaleUpperCase() || 'L'}</span>
    </div>
  );
}
