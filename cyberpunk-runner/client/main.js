import { Game } from './core/game.js';
import { MainMenu } from './ui/menu.js';

let game = null;

async function startGame(nickname, skin) {
  const canvas = document.getElementById('game-canvas');
  const loadingEl = document.getElementById('loading');

  if (loadingEl) {
    loadingEl.style.display = 'flex';
    loadingEl.querySelector('.loading-text').textContent = 'ПОДКЛЮЧЕНИЕ К СЕРВЕРУ...';
  }

  game = new Game(canvas);
  await game.init(nickname, skin);

  if (loadingEl) {
    loadingEl.querySelector('.loading-text').textContent = 'ЗАГРУЗКА МИРА...';
  }

  try {
    await game.connect();
  } catch (err) {
    console.error('Connection failed:', err);
    if (loadingEl) {
      loadingEl.querySelector('.loading-text').textContent = 'ОШИБКА ПОДКЛЮЧЕНИЯ. ЗАПУСК ОФФЛАЙН...';
    }
    // Start in offline mode with local seed
    game.seed = Date.now();
    game.level.setSeed(game.seed);
  }

  if (loadingEl) {
    loadingEl.style.display = 'none';
  }

  game.start();
}

// Initialize menu
document.addEventListener('DOMContentLoaded', () => {
  const menu = new MainMenu();
  menu.init((nickname, skin) => {
    startGame(nickname, skin);
  });
});
