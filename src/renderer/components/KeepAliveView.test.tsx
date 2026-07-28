import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { KeepAliveView } from './KeepAliveView';

afterEach(() => cleanup());

describe('KeepAliveView', () => {
  it('mounts on first visit and preserves child state while hidden', () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();

    function StatefulPage() {
      const [value, setValue] = useState('');
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return (
        <input
          data-testid="page-input"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      );
    }

    const { rerender } = render(
      <KeepAliveView active={false}><StatefulPage /></KeepAliveView>,
    );
    expect(screen.queryByTestId('page-input')).not.toBeInTheDocument();

    rerender(<KeepAliveView active><StatefulPage /></KeepAliveView>);
    fireEvent.change(screen.getByTestId('page-input'), { target: { value: 'kept' } });

    rerender(<KeepAliveView active={false}><StatefulPage /></KeepAliveView>);
    const hiddenInput = screen.getByTestId('page-input') as HTMLInputElement;
    expect(hiddenInput.value).toBe('kept');
    expect(hiddenInput.closest('.app-view-slot')).toHaveAttribute('hidden');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();

    rerender(<KeepAliveView active><StatefulPage /></KeepAliveView>);
    expect((screen.getByTestId('page-input') as HTMLInputElement).value).toBe('kept');
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});
