'use client';

// 完了したときのコイン演出。金額が大きいほど枚数が増える。
export function flyCoins(from: HTMLElement, to: HTMLElement, amount: number, onDone?: () => void) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onDone?.();
    return;
  }
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const n = Math.max(3, Math.min(12, Math.round(Math.log10(Math.max(1, amount)) * 3)));
  const bx = b.left + b.width / 2 - 16;
  const by = b.top + b.height / 2 - 16;
  let landed = 0;

  for (let i = 0; i < n; i++) {
    const coin = document.createElement('img');
    coin.className = 'coin-fly';
    coin.src = '/assets/ui/coin-01.png';
    const sx = a.left + a.width / 2 - 16 + (Math.random() - 0.5) * a.width * 0.7;
    const sy = a.top + a.height / 2 - 16 + (Math.random() - 0.5) * 18;
    coin.style.left = sx + 'px';
    coin.style.top = sy + 'px';
    document.body.appendChild(coin);

    let f = Math.floor(Math.random() * 4);
    const spin = setInterval(() => {
      f = (f + 1) % 4;
      coin.src = '/assets/ui/coin-0' + (f + 1) + '.png';
    }, 70);

    const dx = bx - sx;
    const dy = by - sy;
    const lift = 110 + Math.random() * 70;
    const anim = coin.animate(
      [
        { transform: 'translate(0,0) scale(.9)', opacity: 0.9 },
        {
          transform: 'translate(' + dx * 0.45 + 'px,' + (dy * 0.45 - lift) + 'px) scale(1.55)',
          opacity: 1,
          offset: 0.5,
        },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.7)', opacity: 0.85 },
      ],
      { duration: 620 + i * 55 + Math.random() * 90, easing: 'cubic-bezier(.3,.05,.35,1)' },
    );

    anim.onfinish = () => {
      clearInterval(spin);
      coin.remove();
      sparks(bx + 16, by + 16);
      if (++landed === n && onDone) onDone();
    };
  }
}

function sparks(x: number, y: number) {
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    document.body.appendChild(s);
    const ang = Math.random() * Math.PI * 2;
    const r = 16 + Math.random() * 26;
    s.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        {
          transform: 'translate(' + Math.cos(ang) * r + 'px,' + Math.sin(ang) * r + 'px) scale(0)',
          opacity: 0,
        },
      ],
      { duration: 420 + Math.random() * 220, easing: 'ease-out' },
    ).onfinish = () => s.remove();
  }
}
