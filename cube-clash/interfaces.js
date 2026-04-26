// Interface definitions (abstractions) used by the use case layer.
// JavaScript has no native interface keyword; these are runtime base classes
// describing the shape every adapter must provide. Use cases depend only
// on these abstractions, never on concrete adapters.
//
// Wrapped in an IIFE so this file loads cleanly from `file://` (no ES-module
// CORS issue). Contracts are exposed via `CubeClash.interfaces`.

(function (CubeClash) {
  'use strict';

  class IRenderer {
    /** Initialize the renderer (load scene, lights, etc). */
    init(_match) { throw new Error('IRenderer.init not implemented'); }
    /** Render one frame for the given match state. */
    render(_match, _dt) { throw new Error('IRenderer.render not implemented'); }
    /** Release resources for entities that no longer exist. */
    syncEntities(_match) { throw new Error('IRenderer.syncEntities not implemented'); }
    /** Resize backing buffer when viewport changes. */
    resize(_w, _h) { throw new Error('IRenderer.resize not implemented'); }
  }

  class IInputProvider {
    /**
     * Returns a snapshot of the current input state:
     * {
     *   move: { x: -1..1, z: -1..1 }, // strafe / forward intent in player-local space
     *   look: { yawDelta, pitchDelta },// mouse delta this frame
     *   fire: bool,
     *   jump: bool                    // true on the frame jump was pressed
     * }
     */
    sample(_dt) { throw new Error('IInputProvider.sample not implemented'); }
    /**
     * Returns true when the input source is "active" — for the keyboard +
     * mouse adapter, this means pointer-lock is engaged. Used by the
     * composition root to decide when to start ticking the match.
     * Defaults to true so simpler providers don't need to override.
     */
    isLocked() { return true; }
    dispose() {}
  }

  class IUiPresenter {
    update(_match) { throw new Error('IUiPresenter.update not implemented'); }
    showMatchOver(_match) { throw new Error('IUiPresenter.showMatchOver not implemented'); }
    hideMatchOver() { throw new Error('IUiPresenter.hideMatchOver not implemented'); }
    onPlayAgain(_cb) { throw new Error('IUiPresenter.onPlayAgain not implemented'); }
  }

  class IMatchRepository {
    save(_match) { throw new Error('IMatchRepository.save not implemented'); }
    load() { throw new Error('IMatchRepository.load not implemented'); }
    clear() { throw new Error('IMatchRepository.clear not implemented'); }
  }

  CubeClash.interfaces = {
    IRenderer, IInputProvider, IUiPresenter, IMatchRepository,
  };
})(window.CubeClash = window.CubeClash || {});
