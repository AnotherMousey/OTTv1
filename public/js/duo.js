// Two fez folks who play oẳn tù tì against each other on the login / sign-up pages.
// Needs avatar.js and rps.js.
function startDuo(el, leftAvatar, rightAvatar) {
  const BEATS = { R: 'S', P: 'R', S: 'P' };
  const guys = { L: { av: leftAvatar, wins: 0 }, R: { av: rightAvatar, wins: 0 } };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  el.innerHTML = `
    <div class="duo-guy" data-side="L"><div class="duo-avatar"></div><div class="duo-bubble"></div></div>
    <div class="duo-score" title="tỉ số"></div>
    <div class="duo-guy right" data-side="R"><div class="duo-avatar"></div><div class="duo-bubble"></div></div>`;
  const part = (side, cls) => el.querySelector(`.duo-guy[data-side="${side}"] .${cls}`);
  const guyEl = side => el.querySelector(`.duo-guy[data-side="${side}"]`);

  function draw(side, face = {}) {
    const { mouth, ...look } = face;
    part(side, 'duo-avatar').innerHTML = avatarSvg({ ...guys[side].av, ...look }, 110, { flip: side === 'R', mouth });
  }
  function say(side, html, pump = true) {
    const b = part(side, 'duo-bubble');
    b.innerHTML = html;
    b.classList.add('show');
    if (pump) { b.classList.remove('pump'); void b.offsetWidth; b.classList.add('pump'); }
  }
  function hush(side) { part(side, 'duo-bubble').classList.remove('show'); }
  function act(side, cls) {
    const g = guyEl(side);
    g.classList.remove('cheer', 'sulk', 'hop');
    void g.offsetWidth;
    g.classList.add(cls);
  }
  function score() {
    el.querySelector('.duo-score').innerHTML = `<b style="color:#e2433f">${guys.L.wins}</b> : <b style="color:#3a7bd5">${guys.R.wins}</b>`;
  }

  // Click a guy: he hops and says hi.
  ['L', 'R'].forEach(side => guyEl(side).addEventListener('click', () => {
    if (busy) return;
    act(side, 'hop');
    say(side, side === 'L' ? 'chào! 👋' : 'hế lô! 👋');
    setTimeout(() => { if (!busy) hush(side); }, 1200);
  }));

  let busy = false;
  async function round() {
    busy = true;
    for (const word of ['oẳn…', 'tù…', 'tì!']) {
      say('L', word); say('R', word);
      await wait(420);
    }
    const moves = 'RPS';
    const a = moves[Math.floor(Math.random() * 3)], b = moves[Math.floor(Math.random() * 3)];
    say('L', rpsIcon(a, 40)); say('R', rpsIcon(b, 40));
    await wait(350);
    if (a === b) {
      draw('L', { eyes: 'wide', mouth: 'o' }); draw('R', { eyes: 'wide', mouth: 'o' });
    } else {
      const winner = BEATS[a] === b ? 'L' : 'R', loser = winner === 'L' ? 'R' : 'L';
      guys[winner].wins++;
      draw(winner, { eyes: 'happy', mouth: 'grin' });
      draw(loser, { eyes: 'wide', mouth: 'frown' });
      act(winner, 'cheer');
      act(loser, 'sulk');
      score();
    }
    await wait(1700);
    hush('L'); hush('R');
    draw('L'); draw('R');
    busy = false;
    setTimeout(round, 2200 + Math.random() * 1500);
  }

  draw('L'); draw('R'); score();
  setTimeout(round, 900);
}
