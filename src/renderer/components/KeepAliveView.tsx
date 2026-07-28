import { useEffect, useState, type ReactNode } from 'react';

export function KeepAliveView({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(active);

  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);

  if (!active && !visited) return null;

  return (
    <div className="app-view-slot" hidden={!active}>
      {children}
    </div>
  );
}
