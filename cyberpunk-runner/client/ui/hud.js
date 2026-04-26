import { OVERDRIVE_CHARGE_MAX } from '../../shared/constants.js';

export class HUD {
  constructor() {
    this.container = null;
    this.elements = {};
    this.visible = false;
  }

  init() {
    this.container = document.getElementById('hud');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'hud';
      document.body.appendChild(this.container);
    }

    this.container.innerHTML = `
      <div class="hud-top">
        <div class="hud-distance">
          <span class="hud-label">ДИСТАНЦИЯ</span>
          <span class="hud-value" id="hud-distance">0</span>
          <span class="hud-unit">м</span>
        </div>
        <div class="hud-score">
          <span class="hud-label">ОЧКИ</span>
          <span class="hud-value" id="hud-score">0</span>
        </div>
        <div class="hud-credits">
          <span class="hud-label">КРЕДИТЫ</span>
          <span class="hud-value" id="hud-credits">0</span>
          <span class="hud-unit">¢</span>
        </div>
        <div class="hud-speed">
          <span class="hud-label">СКОРОСТЬ</span>
          <span class="hud-value" id="hud-speed">0</span>
          <span class="hud-unit">км/ч</span>
        </div>
      </div>

      <div class="hud-overdrive">
        <div class="hud-overdrive-label">ОВЕРДРАЙВ</div>
        <div class="hud-overdrive-bar">
          <div class="hud-overdrive-fill" id="hud-overdrive-fill"></div>
        </div>
        <div class="hud-overdrive-hint" id="hud-overdrive-hint">[ SHIFT ]</div>
      </div>

      <div class="hud-leaderboard" id="hud-leaderboard">
        <div class="hud-lb-title">ТОП БЕГУНЫ</div>
        <div class="hud-lb-list" id="hud-lb-list"></div>
      </div>

      <div class="hud-contract" id="hud-contract" style="display:none;">
        <div class="hud-contract-label">КОНТРАКТ</div>
        <div class="hud-contract-text" id="hud-contract-text"></div>
        <div class="hud-contract-progress" id="hud-contract-progress"></div>
      </div>

      <div class="hud-collect-flash" id="hud-collect-flash"></div>
      <div class="hud-drone-mode" id="hud-drone-mode" style="display:none;">
        РЕЖИМ ДРОНА — НАБЛЮДЕНИЕ
      </div>
    `;

    this.elements = {
      distance: document.getElementById('hud-distance'),
      score: document.getElementById('hud-score'),
      credits: document.getElementById('hud-credits'),
      speed: document.getElementById('hud-speed'),
      overdriveFill: document.getElementById('hud-overdrive-fill'),
      overdriveHint: document.getElementById('hud-overdrive-hint'),
      leaderboardList: document.getElementById('hud-lb-list'),
      contract: document.getElementById('hud-contract'),
      contractText: document.getElementById('hud-contract-text'),
      contractProgress: document.getElementById('hud-contract-progress'),
      collectFlash: document.getElementById('hud-collect-flash'),
      droneMode: document.getElementById('hud-drone-mode'),
    };

    this.visible = true;
  }

  update(state) {
    if (!this.visible) return;

    this.elements.distance.textContent = Math.floor(state.distance);
    this.elements.score.textContent = state.score;
    this.elements.credits.textContent = state.credits;
    this.elements.speed.textContent = Math.floor(state.speed * 3.6);

    const overdrivePct = (state.overdrive / OVERDRIVE_CHARGE_MAX) * 100;
    this.elements.overdriveFill.style.width = `${overdrivePct}%`;

    if (state.overdrive >= OVERDRIVE_CHARGE_MAX) {
      this.elements.overdriveHint.classList.add('ready');
      this.elements.overdriveFill.classList.add('ready');
    } else {
      this.elements.overdriveHint.classList.remove('ready');
      this.elements.overdriveFill.classList.remove('ready');
    }

    if (state.overdriveActive) {
      this.elements.overdriveFill.classList.add('active');
    } else {
      this.elements.overdriveFill.classList.remove('active');
    }

    // Leaderboard
    if (state.leaderboard && state.leaderboard.length > 0) {
      this.updateLeaderboard(state.leaderboard);
    }
  }

  updateLeaderboard(lb) {
    if (!this.elements.leaderboardList) return;
    const top5 = lb.slice(0, 5);
    this.elements.leaderboardList.innerHTML = top5
      .map(
        (p, i) =>
          `<div class="hud-lb-row${p.alive ? '' : ' dead'}">
            <span class="hud-lb-rank">${i + 1}</span>
            <span class="hud-lb-name">${p.nickname}</span>
            <span class="hud-lb-dist">${p.distance}м</span>
          </div>`
      )
      .join('');
  }

  showContract(contract) {
    if (!this.elements.contract) return;
    this.elements.contract.style.display = 'block';
    this.elements.contractText.textContent = contract.label;
    this.elements.contractProgress.textContent = `${contract.progress || 0}/${contract.target}`;
  }

  flashCollect(type) {
    const flash = this.elements.collectFlash;
    if (!flash) return;
    const labels = {
      credit: '+10 ¢',
      battery: 'ЗАРЯД +25',
      key_fragment: 'КЛЮЧ-ФРАГМЕНТ!',
    };
    flash.textContent = labels[type] || '+';
    flash.classList.add('show');
    setTimeout(() => flash.classList.remove('show'), 600);
  }

  showDroneMode() {
    if (this.elements.droneMode) {
      this.elements.droneMode.style.display = 'block';
    }
  }

  showDeathScreen(data) {
    // Create death overlay
    let overlay = document.getElementById('death-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'death-overlay';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="death-content">
        <div class="death-title">СИСТЕМА ОТКЛЮЧЕНА</div>
        <div class="death-glitch" data-text="GAME OVER">GAME OVER</div>
        <div class="death-stats">
          <div class="death-stat">
            <span class="death-stat-label">ДИСТАНЦИЯ</span>
            <span class="death-stat-value">${Math.floor(data.distance)} м</span>
          </div>
          <div class="death-stat">
            <span class="death-stat-label">ОЧКИ</span>
            <span class="death-stat-value">${data.score}</span>
          </div>
          <div class="death-stat">
            <span class="death-stat-label">КРЕДИТЫ</span>
            <span class="death-stat-value">${data.credits} ¢</span>
          </div>
        </div>
        <div class="death-buttons">
          <button class="cyber-btn primary" id="btn-restart">БЕЖАТЬ СНОВА</button>
          <button class="cyber-btn secondary" id="btn-drone">РЕЖИМ ДРОНА</button>
        </div>
      </div>
    `;
    overlay.classList.add('show');

    document.getElementById('btn-restart').addEventListener('click', () => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 300);
      data.onRestart();
    });

    document.getElementById('btn-drone').addEventListener('click', () => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 300);
      data.onDrone();
    });
  }

  hide() {
    if (this.container) this.container.style.display = 'none';
    this.visible = false;
  }

  show() {
    if (this.container) this.container.style.display = 'block';
    this.visible = true;
  }
}
