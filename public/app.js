// Les perfs de La Boulangère Wonderligue — site statique, sans framework.
// Données : data/games.json (calendrier LFB + performances tirées des feuilles de match FIBA LiveStats), config/site.json.

const $main = document.getElementById('main');
const state = { games: [], config: {}, updated: null, players: new Map() };

// ---------- utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const noon = (ymd) => new Date(`${ymd}T12:00:00Z`);
const dateFR = (ymd, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  noon(ymd).toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' }).replace(/(^|\s)1 /, '$11er ');
const timeParis = (utc) =>
  new Date(utc).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', ' h ');
const fmt1 = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Mode éditeur : activé une fois par appareil en ouvrant le site avec ?admin (désactivé avec ?admin=0).
const params = new URLSearchParams(location.search);
const ADMIN = (() => {
  try {
    if (params.has('admin')) params.get('admin') === '0' ? localStorage.removeItem('lfb-admin') : localStorage.setItem('lfb-admin', '1');
    return localStorage.getItem('lfb-admin') === '1';
  } catch {
    return params.has('admin') && params.get('admin') !== '0';
  }
})();

// ---------- liens ----------
// Bouton « Clipper » (mode éditeur) : outil de clipping du Mac avec le match complet (chaîne LFB TV), la feuille de
// match FIBA LiveStats (play-by-play), la joueuse (nom, numéro, équipe : 1 = à domicile) et le préréglage de zones
// « lfb » (habillage de la Wonderligue) : l'outil pose les zones et lance l'analyse.
function clipLinks(g, p) {
  const clip = state.config.clipping;
  if (!ADMIN || !clip?.url || !g.youtube) return [];
  const q = new URLSearchParams({
    video: g.youtube,
    pbp: g.links.livestats,
    name: p.name,
    number: p.jersey,
    team: p.side === 'home' ? '1' : '2',
    zones: 'lfb',
    t: Date.now().toString(36),
  });
  const out = [{ label: clip.label ?? 'Clipper', url: `${clip.url}?${q}`, title: 'Match complet : ouvrir dans l\'outil de clipping (vidéo, feuille de match FIBA LiveStats, joueuse et zones préremplies, analyse lancée)' }];
  if (p.stats.ast >= 10) {
    q.set('mode', 'passes');
    out.push({ label: `${clip.label ?? 'Clipper'} passes`, url: `${clip.url}?${q}`, title: `${p.stats.ast} passes décisives : montage des paniers sur ses passes` });
  }
  return out;
}

function gameLinks(g, p) {
  return [
    { label: 'FIBA LiveStats', url: g.links.livestats, title: 'Feuille de match officielle (box score et play-by-play)' },
    g.links.lfb ? { label: 'Fiche LFB', url: g.links.lfb, title: 'Page du match sur basketlfb.com' } : null,
    g.youtube ? { label: 'Match complet', url: g.youtube, title: 'Match complet sur LFB TV (YouTube)' } : null,
    ...(p ? clipLinks(g, p) : []),
  ].filter(Boolean);
}
const linkTag = (l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener"${l.title ? ` title="${esc(l.title)}"` : ''}>${esc(l.label)}</a>`;
const linksHTML = (g, p) => `<div class="links">${gameLinks(g, p).map(linkTag).join('')}</div>`;

// ---------- blocs ----------
function statlineHTML(s) {
  const cell = (k, v, sub = '') => `<div><dt>${k}</dt><dd>${v}${sub ? ` <span>${sub}</span>` : ''}</dd></div>`;
  return `<dl class="statline">
    ${cell('MIN', Math.round(s.min))}
    ${cell('REB', s.reb, `${s.oreb}/${s.dreb}`)}
    ${cell('PD', s.ast)}
    ${cell('INT', s.stl)}
    ${cell('CTR', s.blk)}
    ${cell('BP', s.to)}
    ${cell('FTE', s.pf)}
    ${cell('TIRS', `${s.fgm}-${s.fga}`)}
    ${cell('3 PTS', `${s.tpm}-${s.tpa}`)}
    ${cell('LF', `${s.ftm}-${s.fta}`)}
  </dl>`;
}

function opponent(g, p) {
  const us = g[p.side];
  const them = p.side === 'home' ? g.away : g.home;
  const res = us.score > them.score ? 'V' : us.score < them.score ? 'D' : 'N';
  return { us, them, where: p.side === 'home' ? 'vs' : 'à', res };
}

function gameMeta(g, p) {
  const { us, them, where, res } = opponent(g, p);
  return `<div class="game-meta">${where} ${esc(them.name)} · <span class="${res === 'V' ? 'res-w' : 'res-l'}">${res} ${us.score}-${them.score}</span><br>`
    + `Journée ${g.round} · ${esc(dateFR(g.date))} · ${esc(timeParis(g.tipoff_utc))}</div>`;
}

const face = (p, big = false) => (p.photo ? `<img class="face${big ? ' big' : ''}" src="${esc(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '');

function cardHTML(g, p) {
  return `<article class="card big">
    <div class="card-head">
      <div class="who">${face(p)}<div>
        <h3><a href="#/joueuse/${esc(p.player_id)}">${esc(p.name)}</a></h3>
        <div class="team">${esc(p.team)} · n°${esc(p.jersey)}</div>
      </div></div>
      <div class="pts">${p.stats.pts}<small>PTS</small></div>
    </div>
    ${gameMeta(g, p)}
    ${statlineHTML(p.stats)}
    <div class="badges">${p.tags.map((t) => `<span class="badge accent">${esc(t)}</span>`).join('')}<span class="badge">${p.starter ? 'Titulaire' : 'Remplaçante'}</span></div>
    ${linksHTML(g, p)}
  </article>`;
}

// ---------- pages ----------
const rounds = () => [...new Set(state.games.filter((g) => g.played).map((g) => g.round))].sort((a, b) => a - b);

function pageRound(n) {
  const all = rounds();
  const round = n ?? all.at(-1);
  if (round == null) return '<h1>Dernière journée</h1><p class="empty">Aucun match joué pour l\'instant.</p>';
  const games = state.games.filter((g) => g.round === round);
  const played = games.filter((g) => g.played);
  const perfs = played.flatMap((g) => g.perfs.map((p) => ({ g, p })))
    .sort((a, b) => b.p.stats.pts - a.p.stats.pts || b.p.stats.reb - a.p.stats.reb);
  const i = all.indexOf(round);
  const href = (r) => (r === all.at(-1) ? '#/' : `#/journee/${r}`);
  const prev = all[i - 1];
  const next = all[i + 1];
  const dates = [...new Set(games.map((g) => g.date))].sort();
  const span = dates.length ? (dates.length > 1 ? `du ${dateFR(dates[0])} au ${dateFR(dates.at(-1))}` : dateFR(dates[0])) : '';
  return `<h1>Journée ${round}</h1>
    <p class="page-sub">${esc(span)} · ${played.length}/${games.length} matchs joués · ${perfs.length} performance${perfs.length > 1 ? 's' : ''} à 20 points ou en double-double</p>
    <div class="day-nav">
      ${prev != null ? `<a class="btn ghost" href="${href(prev)}">← Journée ${prev}</a>` : ''}
      ${next != null ? `<a class="btn ghost" href="${href(next)}">Journée ${next} →</a>` : ''}
    </div>
    <div class="cards">${perfs.map(({ g, p }) => cardHTML(g, p)).join('') || '<p class="empty">Aucune performance à 20 points ou en double-double.</p>'}</div>
    <div class="round-games absents"><h2>Matchs de la journée</h2><ul>${games.map((g) => `<li>${esc(g.home.name)} ${g.played ? `<strong>${g.home.score}-${g.away.score}</strong>` : '–'} ${esc(g.away.name)}
      <span class="muted">· ${esc(dateFR(g.date, { weekday: 'short', day: 'numeric', month: 'short' }))} ${esc(timeParis(g.tipoff_utc))}${g.played && !g.validated ? ' · feuille de match en attente' : ''}</span>
      ${g.played ? ` · ${gameLinks(g).map(linkTag).join(' · ')}` : ''}</li>`).join('')}</ul>
      </div>`;
}

function pagePlayer(id) {
  const rows = state.games.flatMap((g) => g.perfs.filter((p) => p.player_id === id).map((p) => ({ g, p })))
    .sort((a, b) => b.g.tipoff_utc.localeCompare(a.g.tipoff_utc));
  if (!rows.length) return `<p><a href="#/joueuses">← Joueuses</a></p><p class="empty">Joueuse inconnue.</p>`;
  const last = rows[0].p;
  const teams = [...new Set(rows.map((r) => r.p.team))].join(', ');
  const best = Math.max(...rows.map((r) => r.p.stats.pts));
  const dd = rows.filter((r) => r.p.tags.some((t) => /double/i.test(t))).length;
  return `<p><a href="${esc(backTo)}">← ${esc(backTo.startsWith('#/joueuses') ? 'Joueuses' : 'Journée')}</a></p>
    <div class="who" style="margin-bottom:12px">${face(last, true)}<div><h1 style="margin:0">${esc(last.name)}</h1><p class="page-sub" style="margin:0">${esc(teams)}</p></div></div>
    <p class="page-sub">${rows.length} performance${rows.length > 1 ? 's' : ''} · record : ${best} points · ${dd} double-double${dd > 1 ? 's' : ''}</p>
    <div class="cards">${rows.map(({ g, p }) => cardHTML(g, p)).join('')}</div>`;
}

const listState = { sort: 'n' };
function pagePlayers() {
  const by = new Map();
  for (const g of state.games) for (const p of g.perfs) {
    const x = by.get(p.player_id) ?? { id: p.player_id, name: p.name, team: p.team, photo: p.photo, n: 0, pts20: 0, dd: 0, best: 0, last: '' };
    x.n++;
    if (p.stats.pts >= (state.config.highlight?.points ?? 20)) x.pts20++;
    if (p.tags.some((t) => /double/i.test(t))) x.dd++;
    x.best = Math.max(x.best, p.stats.pts);
    if (g.tipoff_utc > x.last) { x.last = g.tipoff_utc; x.team = p.team; x.photo = p.photo || x.photo; }
    by.set(p.player_id, x);
  }
  const k = listState.sort;
  const list = [...by.values()].sort((a, b) => (k === 'name' ? a.name.localeCompare(b.name, 'fr') : b[k] - a[k] || b.n - a.n || b.best - a.best));
  const th = (key, label) => `<th scope="col"><button type="button" class="sort" data-sort="${key}"${k === key ? ' aria-sort="descending"' : ''}>${label}</button></th>`;
  return `<h1>Joueuses</h1>
    <p class="page-sub">${list.length} joueuses ont au moins une performance à 20 points ou en double-double</p>
    <div class="table-wrap"><table>
      <thead><tr>${th('name', 'Joueuse')}<th scope="col">Club</th>${th('n', 'Perfs')}${th('pts20', '20 pts +')}${th('dd', 'Double-doubles')}${th('best', 'Record')}</tr></thead>
      <tbody>${list.map((x) => `<tr><td class="first-col"><a href="#/joueuse/${esc(x.id)}">${esc(x.name)}</a></td><td>${esc(x.team)}</td><td>${x.n}</td><td>${x.pts20}</td><td>${x.dd}</td><td>${x.best}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

// ---------- navigation ----------
let backTo = '#/';
function render() {
  const [, page, arg] = location.hash.replace(/^#\/?/, '#/').split('/');
  let html;
  let nav = 'home';
  if (page === 'joueuse') { html = pagePlayer(decodeURIComponent(arg ?? '')); nav = ''; }
  else if (page === 'joueuses') { html = pagePlayers(); nav = 'joueuses'; }
  else if (page === 'journee' && arg) { html = pageRound(Number(arg)); nav = Number(arg) === rounds().at(-1) ? 'home' : ''; }
  else html = pageRound();
  $main.innerHTML = html;
  document.querySelectorAll('[data-nav]').forEach((a) => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = page === 'joueuse' ? `${$main.querySelector('h1')?.textContent ?? ''} · Les perfs de la Wonderligue` : 'Les perfs de La Boulangère Wonderligue';
}

$main.addEventListener('click', (e) => {
  const b = e.target.closest('button.sort');
  if (!b) return;
  listState.sort = b.dataset.sort;
  render();
});

let lastHash = location.hash;
const scrollOf = {};
window.addEventListener('hashchange', () => {
  const pg = (h) => h.replace(/^#\/?/, '#/').split('/')[1] || '';
  const norm = (h) => (h && h !== '#' ? h : '#/');
  const from = norm(lastHash), to = norm(location.hash);
  scrollOf[from] = window.scrollY;
  if (pg(to) === 'joueuse' && pg(from) !== 'joueuse') backTo = from;
  render();
  if (pg(from) === 'joueuse' && to === backTo && scrollOf[to] != null) window.scrollTo(0, scrollOf[to]);
  else if (to !== from) window.scrollTo(0, 0);
  lastHash = location.hash;
});

async function load() {
  const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${u} : ${r.status}`);
    return r.json();
  });
  try {
    const [games, config] = await Promise.all([get('data/games.json'), get('config/site.json')]);
    state.games = games.games ?? [];
    state.config = config;
    state.updated = games.updated ?? null;
    if (games.updated) {
      const u = new Date(games.updated);
      document.getElementById('updated').textContent = `Mis à jour le ${updatedText(u)}`;
      $refreshInfo.textContent = `Données du ${updatedText(u)}`;
    }
    render();
  } catch (e) {
    $main.innerHTML = `<p class="empty">Les données n'ont pas pu être chargées (${esc(e.message)}).</p>`;
  }
}

const updatedText = (u) => `${u.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })} à ${timeParis(u)}`;

// ---------- bouton « Actualiser » (réservé à l'éditeur) ----------
// Il ouvre la page GitHub de l'Action (bouton « Run workflow »), puis recharge le site
// tout seul dès que les nouvelles données sont publiées.
const $refresh = document.getElementById('refresh');
const $refreshBtn = document.getElementById('refresh-btn');
const $refreshInfo = document.getElementById('refresh-info');
$refresh.hidden = !ADMIN;

let polling = null;
$refreshBtn.addEventListener('click', async () => {
  const url = state.config.update_workflow_url;
  if (url) window.open(url, '_blank', 'noopener');
  const before = state.updated;
  $refreshBtn.disabled = true;
  $refreshInfo.textContent = url
    ? 'Sur GitHub, cliquer « Run workflow ». Le site se rechargera tout seul (2 à 5 min).'
    : 'Rechargement des données…';
  await load();
  if (!url) {
    $refreshBtn.disabled = false;
    return;
  }
  clearInterval(polling);
  const started = Date.now();
  polling = setInterval(async () => {
    try {
      const r = await fetch('data/games.json', { cache: 'no-cache' }).then((x) => x.json());
      if (r.updated && r.updated !== before) {
        clearInterval(polling);
        await load();
        $refreshInfo.textContent = `Site actualisé : données du ${updatedText(new Date(r.updated))}`;
        $refreshBtn.disabled = false;
      }
    } catch { /* réessai au prochain tour */ }
    if (Date.now() - started > 20 * 60 * 1000) {
      clearInterval(polling);
      $refreshInfo.textContent = 'Pas de nouvelles données après 20 min : vérifier l\'Action sur GitHub.';
      $refreshBtn.disabled = false;
    }
  }, 30000);
});

load();
