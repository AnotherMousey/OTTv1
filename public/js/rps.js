// Cute hand-drawn rock / paper / scissors characters, drawn in a 64 x 64 box.
const INK = '#2b2b2b';

const face = (lx, rx, y, mouth) => `
  <circle cx="${lx}" cy="${y}" r="3.2" fill="${INK}"/><circle cx="${rx}" cy="${y}" r="3.2" fill="${INK}"/>
  <circle cx="${lx + 1}" cy="${y - 1.2}" r="1.1" fill="#fff"/><circle cx="${rx + 1}" cy="${y - 1.2}" r="1.1" fill="#fff"/>
  <ellipse cx="${lx - 5}" cy="${y + 6}" rx="4" ry="2.4" fill="#ff8fa3" opacity=".75"/>
  <ellipse cx="${rx + 5}" cy="${y + 6}" rx="4" ry="2.4" fill="#ff8fa3" opacity=".75"/>
  ${mouth}`;

const RPS_ART = {
  // a lumpy, content little pebble
  R: `
    <path d="M9 45 C5 33 13 19 26 16 C38 11 54 20 57 34 C60 47 49 55 34 55 C21 56 11 54 9 45 Z" fill="#b9b5c6" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M17 28 C20 23 24 21 29 20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".75"/>
    <path d="M47 22 L44 27 L48 29" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="16" cy="40" r="1.6" fill="#8f8a9e"/><circle cx="50" cy="45" r="1.4" fill="#8f8a9e"/>
    ${face(26, 40, 37, `<path d="M29 43 Q33 47 37 43" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`)}`,
  // a slightly tilted sheet with a folded corner, mildly surprised
  P: `
    <g transform="rotate(-6 33 32)">
      <path d="M14 7 L41 7 L52 18 L52 57 L14 57 Z" fill="#fff" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M41 7 L41 18 L52 18" fill="#e6ecf4" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M20 47 L46 47 M20 52 L40 52" stroke="#9cc7ff" stroke-width="2.2" stroke-linecap="round"/>
      ${face(26, 40, 28, `<ellipse cx="33" cy="36" rx="2.6" ry="3.2" fill="${INK}"/>`)}
    </g>`,
  // scissors with a grinning pivot and red loop handles
  S: `
    <path d="M31 33 L16 8 Q14 3 19 5 L37 29 Z" fill="#dde4ee" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M33 33 L48 8 Q50 3 45 5 L27 29 Z" fill="#dde4ee" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M28 38 L23 42 M36 38 L41 42" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="20" cy="49" r="8" fill="none" stroke="${INK}" stroke-width="8"/>
    <circle cx="20" cy="49" r="8" fill="none" stroke="#e2433f" stroke-width="3.6"/>
    <circle cx="44" cy="49" r="8" fill="none" stroke="${INK}" stroke-width="8"/>
    <circle cx="44" cy="49" r="8" fill="none" stroke="#e2433f" stroke-width="3.6"/>
    <circle cx="32" cy="32" r="9.5" fill="#fff" stroke="${INK}" stroke-width="3"/>
    <circle cx="28.8" cy="31" r="1.9" fill="${INK}"/><circle cx="35.2" cy="31" r="1.9" fill="${INK}"/>
    <path d="M29.5 34.5 Q32 37 34.5 34.5" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
  // a forfeited turn: a dizzy little puff of smoke
  X: `
    <path d="M14 42 C6 40 7 28 16 28 C15 18 28 14 33 21 C38 13 52 17 50 28 C59 29 59 42 50 43 C48 51 36 52 32 47 C27 53 15 50 14 42 Z" fill="#ececec" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M22 31 L28 37 M28 31 L22 37 M36 31 L42 37 M42 31 L36 37" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M27 43 Q32 40 37 43" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
};

// Inner markup for embedding inside another SVG (64 x 64 box).
function rpsMarkup(move) {
  return RPS_ART[move] || RPS_ART.X;
}

// Standalone inline <svg>.
function rpsIcon(move, size = 32, cls = '') {
  const label = { R: 'rock', P: 'paper', S: 'scissors', X: 'nothing' }[move] || 'nothing';
  return `<svg class="rps ${cls}" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${label}">${rpsMarkup(move)}</svg>`;
}
