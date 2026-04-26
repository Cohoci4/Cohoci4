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
    InputAdapter, UIAdapter,
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

    function newMatch() {
      const r = startMatchUseCase.execute();
      match = r.match;
      arena = r.arena;
      updateMatchUseCase.arena = arena;
      matchOverShown = false;
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

      if (match) {
        if (!match.over) {
          const snap = input.sample(dt);
          handleInputUseCase.execute({ match, input: snap, dt });
          botAIUseCase.execute({ match, dt });
          updateMatchUseCase.execute({ match, dt });
        }
        renderer.syncEntities(match);
        renderer.render(match, dt);
        ui.update(match);

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
