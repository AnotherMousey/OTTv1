// Campaign leaderboard, shared by the submit page and the live page.
// Everyone sees how many sparring bots each team has beaten and when they finished;
// only the team itself (and the judge) can open the per-bot breakdown.

function fmtClock(iso) {
  return new Date(iso).toLocaleString('vi-VN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Square i lights up when sparring bot i has been beaten (hover a square for the bot's name).
function campaignPips(row, botNames) {
  const flags = row.beatenBots || Array.from({ length: row.total }, (_, i) => i < row.beaten);
  return `<span class="pips">${flags.map((on, i) => {
    const name = botNames && botNames[i] ? `${i + 1}. ${botNames[i]}` : `bot ${i + 1}`;
    return `<i class="${on ? 'on' : ''}" title="${esc(name)}: ${on ? 'đã hạ' : 'chưa hạ'}"></i>`;
  }).join('')}</span>`;
}

// One box per game of a best-of-5 series: ✓ won, ✗ lost, = drew, empty = not played.
function seriesPips(games, needed) {
  const icon = { A: '✓', B: '✗', draw: '=' };
  return `<span class="series">${Array.from({ length: needed }, (_, i) => {
    const g = games[i];
    return `<i class="${g ? { A: 'w', B: 'l', draw: 'd' }[g] : ''}">${g ? icon[g] : ''}</i>`;
  }).join('')}</span>`;
}

function campaignDetail(det) {
  const need = det.gamesNeeded || 5;
  const cards = det.bots.map(b => {
    if (b.beaten) {
      return `<div class="house win"><div class="hn" title="${esc(b.desc || '')}">${esc(b.name)}</div>
        <div class="hs">✓ đã hạ</div>
        <div>${seriesPips(Array(need).fill('A'), need)}</div>
        <div class="hw">thắng cả ${need} ván · bài nộp #${b.beatenBy} · ${esc(fmtClock(b.beatenAt))}</div></div>`;
    }
    let best = '<div class="hw muted">chưa đấu</div>';
    if (b.best && b.best.games) {
      const last = b.best.games[b.best.games.length - 1];
      const why = last === 'B' ? `thua ván ${b.best.games.length}` : last === 'draw' ? `hòa ván ${b.best.games.length}` : '';
      const story = b.best.wins === 0 ? (last === 'draw' ? 'hòa ngay ván 1' : 'thua ngay ván 1') : `thắng ${b.best.wins} ván${why ? ' rồi ' + why : ''}`;
      best = `<div class="hs">${seriesPips(b.best.games, b.best.needed || need)}</div>
        <div class="hw">tốt nhất: ${story} (bài nộp #${b.best.number})</div>`;
    } else if (b.best) {
      best = `<div class="hs"><b>${b.best.score}</b> <span class="muted">:</span> ${b.best.botScore}</div><div class="hw">tốt nhất (bài nộp #${b.best.number})</div>`;
    }
    const live = b.inProgress ? `<div class="hw muted">🥊 ${b.liveGame ? `đang đấu ván ${b.liveGame}/${need}…` : 'đang chờ đấu…'}</div>` : '';
    return `<div class="house ${b.inProgress ? 'pending' : b.best ? 'loss' : ''}"><div class="hn" title="${esc(b.desc || '')}">${esc(b.name)}</div>${best}${live}</div>`;
  }).join('');
  const head = det.finishedAt
    ? `🏁 Hoàn thành chiến dịch! Về đích lúc ${esc(fmtClock(det.finishedAt))} sau ${det.submissions} bài nộp.`
    : `Đã hạ ${det.beatenCount}/${det.bots.length} bot đấu tập qua ${det.submissions} bài nộp. Mọi bài nộp đều được tính, hãy nộp bot mới để hạ nốt số còn lại!`;
  return `<div class="pdetail"><div class="muted" style="font-size:16px">${esc(det.teamName)} · ${head}</div><div class="house-grid">${cards}</div></div>`;
}

// Renders the board into `tbody`. `state` = { openUser, details }; `onOpen(userId|null)` toggles a row.
function renderCampaignTable(tbody, board, state, onOpen) {
  const canOpen = r => ME.role === 'judge' || r.userId === ME.id;
  tbody.innerHTML = board.rows.map(r => {
    const mine = r.userId === ME.id;
    const open = state.openUser === r.userId;
    const row = `<tr class="clickable ${mine ? 'me' : ''} ${r.finishedAt ? 'finished' : ''} ${open ? 'open' : ''}" data-user="${r.userId}" title="${canOpen(r) ? 'xem chi tiết' : 'không được nhìn trộm!'}">
      <td class="rank">${r.finishedAt && r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
      <td><div class="team">${avatarSvg(r.avatar, 38)}<span>${esc(r.teamName)}</span>${r.username ? `<small class="uname">@${esc(r.username)}</small>` : ''}${mine ? '<span class="muted" style="font-size:16px">← bạn!</span>' : ''}${canOpen(r) ? `<span class="caret">${open ? '▾' : '▸'}</span>` : ''}</div></td>
      <td>${campaignPips(r, board.bots)} <span class="pts" style="font-size:24px">${r.beaten}/${r.total}</span></td>
      <td class="pen" title="${esc(penTitle(r))}">${r.pen}</td>
      <td class="hide-sm muted">${r.submissions}</td>
    </tr>`;
    const detail = open && state.details && state.details.userId === r.userId
      ? `<tr class="detail"><td colspan="5">${campaignDetail(state.details)}</td></tr>` : '';
    return row + detail;
  }).join('') || '<tr><td colspan="5" class="center muted">chưa có ai tham gia, hãy là người đầu tiên!</td></tr>';
  $$('tr.clickable', tbody).forEach(tr => tr.onclick = () => {
    const r = board.rows.find(x => x.userId === tr.dataset.user);
    if (!canOpen(r)) {
      tr.classList.remove('nope'); void tr.offsetWidth; tr.classList.add('nope');
      return toast('Không được xem tiến độ của đội khác 🤫');
    }
    onOpen(state.openUser === r.userId ? null : r.userId);
  });
}

const CAMPAIGN_HEAD = '<tr><th>#</th><th>ĐỘI</th><th>THÀNH TÍCH</th><th title="điểm phạt">PEN</th><th class="hide-sm">BÀI NỘP</th></tr>';

// "20 × 2 bài nộp + 47 phút" style explanation for the PEN cell.
function penTitle(r) {
  const parts = [`${r.penSubs} bài nộp × 20`];
  if (r.penMinutes !== null && r.penMinutes !== undefined) parts.push(`${r.penMinutes} phút để về đích`);
  return parts.join(' + ');
}
