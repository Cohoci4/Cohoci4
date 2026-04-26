export class MainMenu {
  constructor() {
    this.container = null;
    this.onJoin = null;
    this.nickname = '';
    this.selectedSkin = 0;
  }

  init(onJoin) {
    this.onJoin = onJoin;
    this.container = document.getElementById('main-menu');
    if (!this.container) return;

    this._setupEvents();
    this._startBackgroundAnimation();
  }

  _setupEvents() {
    const joinBtn = document.getElementById('btn-join');
    const nicknameInput = document.getElementById('nickname-input');
    const skinOptions = document.querySelectorAll('.skin-option');

    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        this.nickname = nicknameInput ? nicknameInput.value.trim() || 'Runner' : 'Runner';
        this._hide();
        if (this.onJoin) this.onJoin(this.nickname, this.selectedSkin);
      });
    }

    if (nicknameInput) {
      nicknameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          joinBtn?.click();
        }
      });
    }

    skinOptions.forEach((opt, idx) => {
      opt.addEventListener('click', () => {
        skinOptions.forEach((o) => o.classList.remove('selected'));
        opt.classList.add('selected');
        this.selectedSkin = idx;
      });
    });
  }

  _startBackgroundAnimation() {
    // Animate neon lines in the menu background
    const bg = document.getElementById('menu-bg-canvas');
    if (!bg) return;
    const ctx = bg.getContext('2d');
    bg.width = window.innerWidth;
    bg.height = window.innerHeight;

    const lines = [];
    for (let i = 0; i < 30; i++) {
      lines.push({
        x: Math.random() * bg.width,
        y: Math.random() * bg.height,
        length: 50 + Math.random() * 200,
        speed: 1 + Math.random() * 3,
        color: ['#00f0ff', '#ff00ff', '#aa00ff', '#ffff00'][Math.floor(Math.random() * 4)],
        alpha: 0.1 + Math.random() * 0.4,
      });
    }

    const animate = () => {
      if (!this.container || this.container.style.display === 'none') return;
      ctx.fillStyle = 'rgba(10, 10, 46, 0.1)';
      ctx.fillRect(0, 0, bg.width, bg.height);

      for (const line of lines) {
        ctx.strokeStyle = line.color;
        ctx.globalAlpha = line.alpha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(line.x, line.y);
        ctx.lineTo(line.x, line.y + line.length);
        ctx.stroke();
        line.y += line.speed;
        if (line.y > bg.height) {
          line.y = -line.length;
          line.x = Math.random() * bg.width;
        }
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(animate);
    };
    animate();
  }

  _hide() {
    if (this.container) {
      this.container.classList.add('hidden');
      setTimeout(() => {
        this.container.style.display = 'none';
      }, 500);
    }
  }

  show() {
    if (this.container) {
      this.container.style.display = 'flex';
      this.container.classList.remove('hidden');
    }
  }
}
