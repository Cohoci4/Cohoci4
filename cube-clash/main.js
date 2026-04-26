// Composition root - wires entities, use cases, and adapters together
// and runs the game loop. The only file that knows about every layer.
//
// Wrapped in an IIFE that exposes `CubeClash.boot()` instead of running
// at top level. The inline bootstrap module in index.html invokes this
// after Three.js has been imported and assigned to `window.THREE`.

(function (CubeClash) {
  'use strict';

  const { adapters, usecases } = CubeClash;
  if (!adapters || !usecases) {
    throw new Error('main.js requires adapters.js and usecases.js to be loaded first');
  }

  const {
    InMemoryMatchRepository, ThreeRendererAdapter,
    InputAdapter, UIAdapter, WebAudioAdapter,
  } = adapters;
  const {
    StartMatchUseCase, UpdateMatchUseCase,
    HandlePlayerInputUseCase, BotAIUseCase,
  } = usecases;

  function boot() {
    const canvas = document.getElementById('game-canvas');

    const matchRepository = new InMemoryMatchRepository();
    const renderer = new ThreeRendererAdapter(canvas);
    const input = new InputAdapter(canvas);
    const ui = new UIAdapter();
    const audio = new WebAudioAdapter();

    // Web Audio requires a user gesture to start; the input adapter knows
    // when that happens, so we route the unlock signal through it.
    input.onUserGesture(() => audio.unlock());

    const startMatchUseCase = new StartMatchUseCase({ matchRepository });
    const updateMatchUseCase = new UpdateMatchUseCase({
      matchRepository,
      startMatchUseCase,
    });
    const handleInputUseCase = new HandlePlayerInputUseCase();
    const botAIUseCase = new BotAIUseCase();

    let match = null;
    let arena = null;
    let matchOverShown = false;
    // The match clock and AI stay frozen until the player has locked the
    // pointer at least once — otherwise bots would shred the player while
    // they're still reading the "Click to start" prompt.
    let started = false;

    function newMatch() {
      const r = startMatchUseCase.execute();
      match = r.match;
      arena = r.arena;
      updateMatchUseCase.arena = arena;
      matchOverShown = false;
      started = false;
      renderer.init(match);
      renderer.syncEntities(match);
      ui.hideMatchOver();
    }

    ui.onPlayAgain(() => newMatch());
    newMatch();

    let lastTime = performance.now();
    const MAX_DT = 1 / 20;

    function tick(now) {
      const dt = Math.min(MAX_DT, (now - lastTime) / 1000);
      lastTime = now;

      if (!started && input.isLocked()) started = true;

      if (match) {
        if (started && !match.over) {
          const snap = input.sample(dt);
          handleInputUseCase.execute({ match, input: snap, dt });
          botAIUseCase.execute({ match, dt });
          updateMatchUseCase.execute({ match, dt });
        } else {
          // Drain queued input/mouse-deltas so they don't accumulate
          // before the match starts ticking.
          input.sample(dt);
        }
        // Drain domain events emitted this tick into every adapter that
        // wants to react. Each adapter consumes only the event types it
        // cares about; use cases are agnostic of who's listening.
        if (match.events.length > 0) {
          renderer.handleEvents(match.events, match);
          ui.handleEvents(match.events, match);
          audio.handleEvents(match.events, match);
          match.events.length = 0;
        }
        renderer.syncEntities(match);
        renderer.render(match, dt);
        ui.update(match);
        audio.update(match, dt);

        if (match.over && !matchOverShown) {
          ui.showMatchOver(match);
          matchOverShown = true;
        }
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  CubeClash.boot = boot;
})(window.CubeClash = window.CubeClash || {});
