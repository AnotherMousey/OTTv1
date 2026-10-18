// Little fez-wearing stick folks, drawn in a 120 x 170 box (feet at y≈165).
// Shared by the browser and the server (the server uses it to validate choices).
(function (root) {
  const INK = '#2b2b2b';

  const AVATAR_OPTIONS = {
    hat: ['#e2433f', '#3a7bd5', '#3fae5a', '#f39c12', '#9b59b6', '#e84393', '#16a085', '#d35400', '#2c3e50', '#f1c40f', '#8d6e63', '#ff8fa3'],
    shirt: ['#ffffff', '#ffd84d', '#9cc7ff', '#ff9b97', '#b5e6c0', '#d7c4f2', '#ffc48a', '#c9c9c9', '#7fd6d0', '#2b2b2b'],
    eyes: ['dots', 'shiny', 'happy', 'sleepy', 'wide', 'wink', 'angry', 'stars'],
    mouth: ['none', 'smile', 'grin', 'flat', 'o', 'tongue', 'smirk', 'teeth'],
    cheeks: ['none', 'blush', 'freckles'],
    extra: ['none', 'glasses', 'shades', 'mustache', 'bowtie', 'bandaid', 'monocle', 'flower'],
  };
  const LABELS = {
    eyes: { dots: 'dots', shiny: 'shiny', happy: 'happy', sleepy: 'sleepy', wide: 'wide', wink: 'wink', angry: 'grumpy', stars: 'starry' },
    mouth: { none: 'none', smile: 'smile', grin: 'grin', flat: 'meh', o: 'ooh', tongue: 'blep', smirk: 'smirk', teeth: 'toothy' },
    cheeks: { none: 'none', blush: 'blush', freckles: 'freckles' },
    extra: { none: 'none', glasses: 'glasses', shades: 'shades', mustache: 'mustache', bowtie: 'bow tie', bandaid: 'band-aid', monocle: 'monocle', flower: 'flower' },
  };

  function hashOf(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  }
  function hatColorFor(name) {
    return AVATAR_OPTIONS.hat[hashOf(name) % AVATAR_OPTIONS.hat.length];
  }

  // Look for someone who never customised anything: hat colour from their team name.
  function defaultAvatar(name = '') {
    return { hat: hatColorFor(name), shirt: '#ffffff', eyes: 'dots', mouth: 'none', cheeks: 'none', extra: 'none' };
  }

  // Coerce anything (stored config, request body, colour string) into a valid avatar.
  function normalizeAvatar(a, name = '') {
    const base = defaultAvatar(name);
    if (typeof a === 'string') return { ...base, hat: a };
    if (!a || typeof a !== 'object') return base;
    const out = {};
    for (const key of Object.keys(base)) {
      const v = a[key];
      out[key] = typeof v === 'string' && AVATAR_OPTIONS[key].includes(v) ? v : base[key];
    }
    return out;
  }

  function randomAvatar() {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    return Object.fromEntries(Object.entries(AVATAR_OPTIONS).map(([k, v]) => [k, pick(v)]));
  }

  // ---------- parts ----------
  const MOUTHS = {
    none: '',
    smile: `<path d="M50 84 Q60 94 70 84" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    frown: `<path d="M51 90 Q60 82 69 90" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    o: `<ellipse cx="60" cy="87" rx="4" ry="5" fill="${INK}"/>`,
    flat: `<path d="M52 87 L68 87" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    grin: `<path d="M48 82 Q60 82 72 82 Q70 96 60 96 Q50 96 48 82 Z" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M53 91 Q60 87 67 91 Q63 95 60 95 Q56 95 53 91 Z" fill="#ff8fa3"/>`,
    tongue: `<path d="M50 84 Q60 93 70 84" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M57 89 Q57 97 61.5 97 Q66 97 66 88" fill="#ff8fa3" stroke="${INK}" stroke-width="2.5"/>`,
    smirk: `<path d="M51 88 Q62 90 70 82" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    teeth: `<rect x="49" y="82" width="22" height="11" rx="5" fill="#fff" stroke="${INK}" stroke-width="3"/><path d="M49 87.5 L71 87.5 M56 82 L56 93 M64 82 L64 93" stroke="${INK}" stroke-width="1.6"/>`,
  };

  const dot = (x, r = 4.5) => `<circle cx="${x}" cy="71" r="${r}" fill="${INK}"/>`;
  const shine = x => `<circle cx="${x + 1.6}" cy="69" r="1.7" fill="#fff"/>`;
  const arc = x => `<path d="M${x - 5} 73 Q${x} 65 ${x + 5} 73" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
  const star = x => `<path d="M${x} 64 L${x + 2} 69 L${x + 7} 69.5 L${x + 3} 72.8 L${x + 4.4} 78 L${x} 75 L${x - 4.4} 78 L${x - 3} 72.8 L${x - 7} 69.5 L${x - 2} 69 Z" fill="#f1c40f" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`;
  const EYES = {
    dots: dot(50) + dot(70),
    shiny: dot(50, 5.2) + dot(70, 5.2) + shine(50) + shine(70),
    happy: arc(50) + arc(70),
    sleepy: `<path d="M45 71 Q50 75 55 71 M65 71 Q70 75 75 71" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
    wide: `<circle cx="50" cy="71" r="6.5" fill="#fff" stroke="${INK}" stroke-width="2.6"/><circle cx="70" cy="71" r="6.5" fill="#fff" stroke="${INK}" stroke-width="2.6"/>${dot(51, 2.8)}${dot(71, 2.8)}`,
    wink: dot(50, 5) + shine(50) + arc(70),
    angry: dot(50) + dot(70) + `<path d="M43 61 L55 65 M77 61 L65 65" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
    stars: star(50) + star(70),
  };
  const CHEEKS = {
    none: '',
    blush: '<ellipse cx="40" cy="80" rx="6" ry="3.5" fill="#ff8fa3" opacity=".75"/><ellipse cx="80" cy="80" rx="6" ry="3.5" fill="#ff8fa3" opacity=".75"/>',
    freckles: [[38, 78], [42, 82], [44, 77], [76, 78], [80, 82], [82, 77]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.3" fill="#a0522d"/>`).join(''),
  };
  const EXTRAS = {
    none: '',
    glasses: `<g fill="none" stroke="${INK}" stroke-width="3"><circle cx="50" cy="71" r="9"/><circle cx="70" cy="71" r="9"/><path d="M59 70 Q60 68 61 70 M41 69 L32 66 M79 69 L88 66"/></g>`,
    shades: `<path d="M38 64 L82 64 L80 72 Q78 79 70 79 Q63 79 61 72 L59 72 Q57 79 50 79 Q42 79 40 72 Z" fill="${INK}"/><path d="M44 67 L48 67" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>`,
    mustache: `<path d="M60 80 Q52 75 46 79 Q42 82 45 85 Q50 82 60 82 Q70 82 75 85 Q78 82 74 79 Q68 75 60 80 Z" fill="${INK}"/>`,
    bowtie: `<path d="M60 102 L47 95 L47 109 Z M60 102 L73 95 L73 109 Z" fill="#e2433f" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="60" cy="102" r="3.5" fill="#e2433f" stroke="${INK}" stroke-width="2.5"/>`,
    bandaid: `<g transform="rotate(-25 77 56)"><rect x="68" y="52" width="18" height="8" rx="3" fill="#f5c58c" stroke="${INK}" stroke-width="2"/><path d="M75 54 L75 58 M79 54 L79 58" stroke="${INK}" stroke-width="1.4"/></g>`,
    monocle: `<circle cx="70" cy="71" r="9" fill="#fff" fill-opacity=".25" stroke="#c9a227" stroke-width="3"/><path d="M78 75 Q82 92 76 104" fill="none" stroke="#c9a227" stroke-width="1.8"/>`,
    flower: `<g transform="translate(78 47)">${[0, 72, 144, 216, 288].map(r => `<ellipse cx="0" cy="-6" rx="4" ry="6" transform="rotate(${r})" fill="#ff8fa3" stroke="${INK}" stroke-width="1.6"/>`).join('')}<circle r="3.5" fill="#f1c40f" stroke="${INK}" stroke-width="1.6"/></g>`,
  };

  // Inner SVG markup. The tassel hangs to the left; mirror it for a right-hand player.
  // `mouth` overrides the chosen mouth (used for reactions); `id` names the mouth group.
  function avatarMarkup(avatar, { mouth, id = '' } = {}) {
    const a = normalizeAvatar(avatar);
    const m = mouth && MOUTHS[mouth] !== undefined && mouth !== 'none' ? mouth : a.mouth;
    const shirt = a.shirt;
    return `
    <g class="av-all">
      <g stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M51 133 L50 162 L43 163" fill="none"/>
        <path d="M69 133 L70 162 L77 163" fill="none"/>
        <path d="M44 99 Q60 95 76 99 L77 136 Q60 139 43 136 Z" fill="${shirt}"/>
        <circle cx="60" cy="68" r="30" fill="#fff"/>
        <path d="M38 50 L45 14 Q60 9 75 14 L82 50 Q60 43 38 50 Z" fill="${a.hat}"/>
        <g class="av-tassel">
          <path d="M60 12 Q34 2 22 16 L18 30" fill="none"/>
          <path d="M12 32 L24 32 L22 42 L14 42 Z" fill="${INK}" stroke-width="3"/>
        </g>
      </g>
      ${CHEEKS[a.cheeks]}
      <g class="av-eyes">${EYES[a.eyes]}</g>
      <g ${id ? `id="${id}"` : ''}>${MOUTHS[m] || ''}</g>
      ${EXTRAS[a.extra]}
    </g>`;
  }

  // Standalone <svg> element string. `avatar` can be a config object or just a hat colour.
  function avatarSvg(avatar, size = 40, { flip = false, mouth, still = false } = {}) {
    const inner = avatarMarkup(avatar, { mouth });
    return `<svg class="av ${still ? '' : 'lively'}" viewBox="0 0 120 170" width="${(size * 120) / 170}" height="${size}" aria-hidden="true">${flip ? `<g transform="translate(120 0) scale(-1 1)">${inner}</g>` : inner}</svg>`;
  }

  const api = { AVATAR_OPTIONS, LABELS, MOUTHS, hatColorFor, defaultAvatar, normalizeAvatar, randomAvatar, avatarMarkup, avatarSvg };
  // Keep every avatar on the page in lockstep: whenever avatars are added, pin all their
  // animations to the same start time (page load), so they blink, sway and hop together.
  if (typeof document !== 'undefined' && document.getAnimations) {
    let queued = false;
    const sync = () => {
      queued = false;
      for (const a of document.getAnimations()) {
        if (a.animationName && a.animationName.startsWith('av-') && a.startTime !== 0) a.startTime = 0;
      }
    };
    new MutationObserver(() => {
      if (!queued) { queued = true; requestAnimationFrame(sync); }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(this);
