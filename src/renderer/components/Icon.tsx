import type { SVGProps } from 'react';

export type IconName =
  | 'add'
  | 'album'
  | 'back'
  | 'edit'
  | 'forward'
  | 'lyrics'
  | 'music'
  | 'pause'
  | 'play'
  | 'refresh'
  | 'repeatOne'
  | 'remove'
  | 'search'
  | 'sequence'
  | 'sparkles'
  | 'shuffle'
  | 'volume';

const paths: Record<IconName, React.ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  album: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><path d="M16.8 7.8 14 10" /></>,
  back: <><path d="M6 5v14" /><path d="m18 6-9 6 9 6Z" /></>,
  edit: <><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8Z" /><path d="m13.8 7 3.2 3.2" /></>,
  forward: <><path d="M18 5v14" /><path d="m6 6 9 6-9 6Z" /></>,
  lyrics: <><path d="M5 5h14v11H9l-4 3Z" /><path d="M8 9h8M8 12h5" /></>,
  music: <><path d="M9 18V6l10-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>,
  pause: <><path d="M8 6v12M16 6v12" /></>,
  play: <path d="m9 6 9 6-9 6Z" />,
  refresh: <><path d="M19 7v5h-5" /><path d="M18 12a6 6 0 1 0-1.4 3.9" /></>,
  repeatOne: <><path d="m17 2 4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="m7 22-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /><path d="M10 10h2v5M10 15h4" /></>,
  remove: <><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 13h8l1-13" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></>,
  sequence: <><path d="M4 6h15M4 12h15M4 18h10" /><path d="m17 15 3 3-3 3" /></>,
  sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z" /><path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7Z" /></>,
  shuffle: <><path d="M3 6h2.5c4.5 0 6.5 12 11 12H21" /><path d="m17 14 4 4-4 4" /><path d="M3 18h2.5c1.8 0 3.2-1.9 4.5-4.2" /><path d="M14 8.2C14.8 6.9 15.6 6 16.5 6H21" /><path d="m17 2 4 4-4 4" /></>,
  volume: <><path d="M4 10v4h4l5 4V6l-5 4Z" /><path d="M16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></>,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
