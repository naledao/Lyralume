import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyralumeApi, RemoteMusicSnapshot } from '../../shared/contracts';
import { useAppStore } from '../store/useAppStore';
import { RemoteMusicPage } from './RemoteMusicPage';

const snapshot: RemoteMusicSnapshot = {
  configured: true,
  online: true,
  autoSync: true,
  refreshedAt: 100,
  items: [{
    syncId: '7d0a144f-5dd1-4501-a213-2299ce0c07f4',
    objectName: 'lyralume/v1/tracks/7d0a144f-5dd1-4501-a213-2299ce0c07f4/audio.mp3',
    fileName: 'Song.mp3',
    title: 'Remote Song',
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    fileSize: 10_000_000,
    lastModified: 100,
    etag: 'etag',
    localTrackId: 'a'.repeat(24),
    syncStatus: 'local_changed',
    progress: 0,
  }],
};

describe('RemoteMusicPage', () => {
  const remote = {
    getSnapshot: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => snapshot),
    testConnection: vi.fn(),
    syncAll: vi.fn(async () => snapshot),
    syncTrack: vi.fn(async () => snapshot),
    onChanged: vi.fn(() => () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.lyralume = { remote } as unknown as LyralumeApi;
    useAppStore.setState({ activeView: 'remote' });
  });

  afterEach(() => cleanup());

  it('shows remote catalog status and starts a single-track sync', async () => {
    render(<RemoteMusicPage />);
    expect(await screen.findByText('Remote Song')).toBeVisible();
    expect(screen.getAllByText('本地有更新')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '同步' }));
    await waitFor(() => expect(remote.syncTrack).toHaveBeenCalledWith('a'.repeat(24)));
  });

  it('routes users to settings when MinIO is not configured', async () => {
    remote.getSnapshot.mockResolvedValueOnce({
      configured: false,
      online: false,
      autoSync: false,
      items: [],
    });
    render(<RemoteMusicPage />);
    fireEvent.click(await screen.findByRole('button', { name: '前往设置' }));
    expect(useAppStore.getState().activeView).toBe('settings');
  });
});
