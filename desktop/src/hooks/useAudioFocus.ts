/**
 * React hook for managing audio focus in components
 *
 * Provides a simple interface for components to acquire/release audio focus
 * for video/audio playback. This hook is designed for use with resource
 * video/audio players (A4 integration).
 *
 * @example
 * ```tsx
 * const { acquire, release, isOwner } = useAudioFocus('video', 'resource-video-123');
 *
 * const handlePlay = () => {
 *   acquire();
 *   videoRef.current?.play();
 * };
 *
 * const handlePause = () => {
 *   release('manual');
 *   videoRef.current?.pause();
 * };
 * ```
 */

import { useRef, useCallback, useEffect } from 'react';
import audioFocusCoordinator, { type AudioFocusType, type SuspensionReason } from '../lib/audioFocus';

export interface UseAudioFocusOptions {
  type: AudioFocusType;
  id?: string;
  onPreempt?: (preemptedBy: any) => void;
  allowPreempt?: boolean;
}

export interface UseAudioFocusReturn {
  acquire: () => void;
  release: (reason?: SuspensionReason) => void;
  isOwner: () => boolean;
  getCurrentOwner: () => any;
}

export function useAudioFocus(options: UseAudioFocusOptions): UseAudioFocusReturn {
  const { type, id, onPreempt, allowPreempt = true } = options;
  const ownerRef = useRef<{ id: string; generation: number } | null>(null);

  const acquire = useCallback(() => {
    const { id: focusId, generation } = audioFocusCoordinator.acquire({
      type,
      id: id || `${type}-${Date.now()}`,
      onPreempt,
      allowPreempt,
    });
    ownerRef.current = { id: focusId, generation };
  }, [type, id, onPreempt, allowPreempt]);

  const release = useCallback((reason?: SuspensionReason) => {
    if (ownerRef.current) {
      audioFocusCoordinator.release({
        id: ownerRef.current.id,
        generation: ownerRef.current.generation,
        suspensionReason: reason || 'manual',
      });
      ownerRef.current = null;
    }
  }, []);

  const isOwner = useCallback(() => {
    if (!ownerRef.current) return false;
    return audioFocusCoordinator.isOwner(ownerRef.current.id, ownerRef.current.generation);
  }, []);

  const getCurrentOwner = useCallback(() => {
    return audioFocusCoordinator.getCurrentOwner();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (ownerRef.current) {
        audioFocusCoordinator.release({
          id: ownerRef.current.id,
          generation: ownerRef.current.generation,
          suspensionReason: 'close',
        });
        ownerRef.current = null;
      }
    };
  }, []);

  return { acquire, release, isOwner, getCurrentOwner };
}

/**
 * Hook for video/audio playback with automatic audio focus management
 *
 * Automatically acquires focus on play and releases on pause/error/unmount.
 *
 * @example
 * ```tsx
 * const videoRef = useRef<HTMLVideoElement>(null);
 * const { handlePlay, handlePause, handleEnded, handleError } = useVideoAudioFocus(videoRef, 'video', 'resource-123');
 *
 * return (
 *   <video
 *     ref={videoRef}
 *     onPlay={handlePlay}
 *     onPause={handlePause}
 *     onEnded={handleEnded}
 *     onError={handleError}
 *   />
 * );
 * ```
 */
export function useVideoAudioFocus(
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement>,
  type: 'video' | 'audio',
  id?: string
) {
  const onPreempt = useCallback(() => mediaRef.current?.pause(), [mediaRef]);
  // Resource audio has the same priority as resource video, not background music.
  const { acquire, release, isOwner } = useAudioFocus({ type: type === 'audio' ? 'video' : type, id, onPreempt });

  const handlePlay = useCallback(() => {
    acquire();
    if (!isOwner()) {
      mediaRef.current?.pause();
      release('automatic');
    }
  }, [acquire, isOwner, mediaRef, release]);

  const handlePause = useCallback(() => {
    release('manual');
  }, [release]);

  const handleEnded = useCallback(() => {
    release('automatic');
  }, [release]);

  const handleError = useCallback(() => {
    release('error');
  }, [release]);

  return { handlePlay, handlePause, handleEnded, handleError };
}
