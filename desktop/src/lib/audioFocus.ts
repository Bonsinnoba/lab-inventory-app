/**
 * Device-local audio focus coordinator
 *
 * Provides a single coordinator for audio/TTS/video/microphone ownership across
 * the desktop application. Prevents competing audio sources from playing simultaneously
 * by enforcing ownership rules with priority-based preemption.
 *
 * Ownership priority (highest to lowest):
 * 1. microphone - voice input requires exclusive audio capture
 * 2. tts - text-to-speech for assistant/notebook read-aloud
 * 3. video - resource video playback
 * 4. music - music player
 *
 * Components acquire focus with an owner token and generation counter. Stale
 * completion callbacks cannot release a newer owner. Suspension reasons are tracked
 * separately to distinguish automatic vs manual pauses.
 */

export type AudioFocusType = 'music' | 'tts' | 'video' | 'microphone';

export type SuspensionReason = 'automatic' | 'manual' | 'track_change' | 'close' | 'account_switch' | 'error';

export interface AudioFocusOwner {
  id: string;
  type: AudioFocusType;
  generation: number;
  createdAt: number;
}

export interface AudioFocusState {
  currentOwner: AudioFocusOwner | null;
  suspendedOwners: Map<string, { owner: AudioFocusOwner; reason: SuspensionReason; savedState?: any }>;
}

export interface AcquireOptions {
  type: AudioFocusType;
  id: string;
  onPreempt?: (preemptedBy: AudioFocusOwner) => void;
  allowPreempt?: boolean;
}

export interface ReleaseOptions {
  id: string;
  generation: number;
  suspensionReason?: SuspensionReason;
  savedState?: any;
}

const PRIORITY_ORDER: Record<AudioFocusType, number> = {
  microphone: 4,
  tts: 3,
  video: 2,
  music: 1,
};

class AudioFocusCoordinator {
  private state: AudioFocusState = {
    currentOwner: null,
    suspendedOwners: new Map(),
  };
  private listeners: Set<(state: AudioFocusState) => void> = new Set();
  private generationCounter = 0;
  private preemptCallbacks = new Map<string, AcquireOptions['onPreempt']>();

  private notifyPreempted(owner: AudioFocusOwner, incoming: AudioFocusOwner): void {
    try {
      this.preemptCallbacks.get(owner.id)?.(incoming);
    } catch (error) {
      console.error('[AudioFocus] Owner preemption callback failed', error);
    }
  }

  /**
   * Generate a unique owner token with generation counter
   */
  private generateOwnerId(type: AudioFocusType): string {
    return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Compare priority of two ownership types
   * Returns positive if a has higher priority than b
   */
  private comparePriority(a: AudioFocusType, b: AudioFocusType): number {
    return PRIORITY_ORDER[a] - PRIORITY_ORDER[b];
  }

  /**
   * Check if an owner is the current owner (with generation validation)
   */
  private isCurrentOwner(id: string, generation: number): boolean {
    const current = this.state.currentOwner;
    return current !== null && current.id === id && current.generation === generation;
  }

  /**
   * Notify all listeners of state change
   */
  private notify(): void {
    this.listeners.forEach(listener => listener(this.getState()));
  }

  /**
   * Acquire audio focus for a component
   *
   * @param options - Acquisition options
   * @returns Owner token with generation counter
   */
  acquire(options: AcquireOptions): { id: string; generation: number } {
    const { type, id, onPreempt, allowPreempt = true } = options;
    const generation = ++this.generationCounter;
    const ownerId = id || this.generateOwnerId(type);
    const newOwner: AudioFocusOwner = {
      id: ownerId,
      type,
      generation,
      createdAt: Date.now(),
    };

    const current = this.state.currentOwner;
    this.preemptCallbacks.set(ownerId, onPreempt);
    // Reacquisition replaces this owner's previous waiting token as well.
    this.state.suspendedOwners.delete(ownerId);

    // No current owner - take focus
    if (!current) {
      this.state.currentOwner = newOwner;
      this.notify();
      return { id: ownerId, generation };
    }

    // Already the current owner - update generation
    if (current.id === ownerId) {
      this.state.currentOwner = newOwner;
      this.notify();
      return { id: ownerId, generation };
    }

    // Compare priority
    const priorityDiff = this.comparePriority(type, current.type);

    // Higher priority - preempt current owner
    if (priorityDiff > 0 && allowPreempt) {
      const suspensionReason: SuspensionReason = 'automatic';
      this.state.suspendedOwners.set(current.id, {
        owner: current,
        reason: suspensionReason,
      });
      this.state.currentOwner = newOwner;

      this.notifyPreempted(current, newOwner);

      this.notify();
      return { id: ownerId, generation };
    }

    // Lower or equal priority - cannot acquire, stay suspended
    this.state.suspendedOwners.set(ownerId, {
      owner: newOwner,
      reason: 'automatic',
    });

    this.notify();
    return { id: ownerId, generation };
  }

  /**
   * Release audio focus for a component
   *
   * @param options - Release options with generation validation
   */
  release(options: ReleaseOptions): void {
    const { id, generation } = options;

    // Release if current owner (with generation check)
    if (this.isCurrentOwner(id, generation)) {
      this.state.currentOwner = null;
      this.preemptCallbacks.delete(id);

      // Resume highest-priority suspended owner
      const suspended = Array.from(this.state.suspendedOwners.entries())
        .sort(([, a], [, b]) => this.comparePriority(b.owner.type, a.owner.type));

      if (suspended.length > 0) {
        const [suspendedId, suspendedData] = suspended[0];
        this.state.suspendedOwners.delete(suspendedId);
        this.state.currentOwner = suspendedData.owner;
      }

      this.notify();
      return;
    }

    // Release if suspended owner
    const suspended = this.state.suspendedOwners.get(id);
    if (suspended && suspended.owner.generation === generation) {
      this.state.suspendedOwners.delete(id);
      this.preemptCallbacks.delete(id);
      this.notify();
      return;
    }

    // Stale release - ignore (newer owner acquired)
    console.warn(`[AudioFocus] Stale release attempt for ${id} (generation ${generation})`);
  }

  /**
   * Check if a component currently owns audio focus
   */
  isOwner(id: string, generation: number): boolean {
    return this.isCurrentOwner(id, generation);
  }

  /**
   * Get the current owner (if any)
   */
  getCurrentOwner(): AudioFocusOwner | null {
    return this.state.currentOwner ? { ...this.state.currentOwner } : null;
  }

  /**
   * Get the full focus state
   */
  getState(): AudioFocusState {
    return {
      currentOwner: this.getCurrentOwner(),
      suspendedOwners: new Map(Array.from(this.state.suspendedOwners, ([id, data]) =>
        [id, { ...data, owner: { ...data.owner } }])),
    };
  }

  /**
   * Subscribe to focus state changes
   */
  subscribe(listener: (state: AudioFocusState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Request that a suspended owner be resumed
   * (called by component when user explicitly wants to resume)
   */
  requestResume(id: string, generation: number): boolean {
    if (this.isCurrentOwner(id, generation)) return true;
    const suspended = this.state.suspendedOwners.get(id);
    if (!suspended || suspended.owner.generation !== generation) {
      return false;
    }

    const current = this.state.currentOwner;

    // No current owner - can resume
    if (!current) {
      this.state.suspendedOwners.delete(id);
      this.state.currentOwner = suspended.owner;
      this.notify();
      return true;
    }

    // Lower priority than current - cannot resume
    if (this.comparePriority(suspended.owner.type, current.type) <= 0) {
      return false;
    }

    // Higher priority - preempt current
    this.state.suspendedOwners.set(current.id, {
      owner: current,
      reason: 'automatic',
    });
    this.state.suspendedOwners.delete(id);
    this.state.currentOwner = suspended.owner;
    this.notifyPreempted(current, suspended.owner);
    this.notify();
    return true;
  }

  /**
   * Reset all focus state (for account switch or explicit close)
   */
  reset(): void {
    this.state = {
      currentOwner: null,
      suspendedOwners: new Map(),
    };
    // Tokens from before account/session reset must never become valid again.
    this.preemptCallbacks.clear();
    this.notify();
  }
}

// Singleton instance
const coordinator = new AudioFocusCoordinator();

export default coordinator;
