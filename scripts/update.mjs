// Mise à jour : calendrier officiel LFB → box score FIBA LiveStats (FFBB) de chaque match joué → performances
// à 20 points ou plus, ou en double-double, de toutes les joueuses de La Boulangère Wonderligue.
//
//   node scripts/update.mjs
//
// Sources :
// - calendrier : basketlfb.com (date et heure, journée, équipes, score, lien FIBA LiveStats, vidéo YouTube du match)
// - stats : fibalivestats.dcd.shared.geniussports.com/data/<id>/data.json (box score officiel de la feuille de match)
import fs from 'node:fs';
import { fetchText, fetchJSON } from './lib/http.mjs';
import { findFullGame } from './lib/youtube.mjs';

const CAL_URL = 'https://basketlfb.com/laboulangerewonderligue/saison-reguliere/calendrier';
const SITE = 'https://basketlfb.com';
const LIVESTATS = 'https://fibalivestats.dcd.shared.geniussports.com';
const OUT = 'data/games.json';
const config = JSON.parse(fs.readFileSync('config/site.json', 'utf8'));

const readJSON = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const store = readJSON(OUT, { games: [] });
const known = new Map(store.games.map((g) => [g.id, g]));
const errors = [];
const missing = [];

// ---------- outils ----------
const decode = (s) => String(s ?? '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .trim();
export const slugify = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// « KOI LOVE » → « Koi Love » ; les noms déjà en casse mixte sont gardés tels quels
const nameCase = (s) => (s && s === s.toUpperCase()
  ? s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  : s ?? '');

// Heure de Paris → instant UTC (gère l'heure d'été)
function parisToUtc(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const [h2, m2] = fmt.format(new Date(guess)).split(':').map(Number);
  const offset = ((h2 * 60 + m2) - (hh * 60 + mm) + 1440) % 1440;   // minutes d'avance de Paris sur UTC
  return new Date(guess - (offset > 720 ? offset - 1440 : offset) * 60000).toISOString();
}

// ---------- calendrier ----------
function parseCalendar(html) {
  const out = [];
  for (const block of html.split('<li class="display-games__third-list__entry').slice(1)) {
    const li = block.split('</li>')[0];
    const genius = /geniussports\.com\/u\/FFBB\/(\d+)/.exec(li)?.[1];
    if (!genius) continue;
    const dm = /class="date">\s*(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/.exec(li);
    if (!dm) continue;
    const [day, month, hh, mm] = dm.slice(1).map(Number);
    const year = month >= 8 ? 2026 : 2027;
    const teams = [...li.matchAll(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>\s*<span class="team__title">([^<]*)<\/span>\s*<\/span>\s*<span class="team__score[^"]*">\s*([^<]*)<\/span>/g)]
      .map((m) => ({ logo: m[1], name: decode(m[2]), code: decode(m[3]), score: /^\d+$/.test(m[4].trim()) ? Number(m[4]) : null }));
    if (teams.length !== 2) continue;
    out.push({
      id: genius,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      tipoff_utc: parisToUtc(year, month, day, hh, mm),
      round: Number(/Journ[ée]e\s+(\d+)/.exec(li)?.[1]) || null,
      home: teams[0],
      away: teams[1],
      youtube: /href="(https:\/\/www\.youtube\.com\/watch\?v=[\w-]+)"/.exec(li)?.[1] ?? null,
      links: {
        livestats: `${LIVESTATS}/u/FFBB/${genius}/`,
        lfb: (() => { const m = /href="(\/laboulangerewonderligue\/saison-reguliere\/match\/[^"]+)"/.exec(li); return m ? SITE + m[1] : null; })(),
      },
    });
  }
  return out;
}

// ---------- box score ----------
const STAT = {
  min: 'sMinutes', pts: 'sPoints', fgm: 'sFieldGoalsMade', fga: 'sFieldGoalsAttempted', tpm: 'sThreePointersMade',
  tpa: 'sThreePointersAttempted', ftm: 'sFreeThrowsMade', fta: 'sFreeThrowsAttempted', oreb: 'sReboundsOffensive',
  dreb: 'sReboundsDefensive', reb: 'sReboundsTotal', ast: 'sAssists', stl: 'sSteals', blk: 'sBlocks', to: 'sTurnovers',
  pf: 'sFoulsPersonal', pm: 'sPlusMinusPoints',
};
const minutes = (v) => {
  const m = /^(\d+):(\d{2})$/.exec(String(v ?? ''));
  return m ? Number(m[1]) + Number(m[2]) / 60 : Number(v) || 0;
};

// Une ligne par joueuse inscrite sur la feuille de match : « played » (a joué), « dnp » (sur la feuille, n'a pas joué).
function lines(game, data) {
  const out = {};
  for (const [tno, side] of [['1', 'home'], ['2', 'away']]) {
    for (const p of Object.values(data.tm?.[tno]?.pl ?? {})) {
      const s = Object.fromEntries(Object.entries(STAT).map(([k, f]) => [k, k === 'min' ? Math.round(minutes(p[f]) * 10) / 10 : Number(p[f]) || 0]));
      const name = `${nameCase(p.firstName)} ${nameCase(p.familyName)}`.trim();
      const id = slugify(name);
      if (!id) continue;
      const played = s.min > 0 || s.pts > 0 || s.reb > 0 || s.ast > 0 || s.fga > 0 || s.fta > 0;
      out[id] = {
        player_id: id,
        name,
        team: game[side].name,
        side,
        jersey: String(p.shirtNumber ?? ''),
        starter: !!Number(p.starter),
        photo: p.photoT || p.photoS || null,
        position: p.playingPosition || '',
        status: played ? 'played' : 'dnp',
        stats: played ? s : null,
      };
    }
  }
  return out;
}

// ---------- traitement ----------
const html = await fetchText(CAL_URL, { ttl: 1800, headers: { 'User-Agent': 'Mozilla/5.0 (LFB-Performances-Tracker)' } });
const calendar = parseCalendar(html);
if (calendar.length < 100) throw new Error(`Calendrier LFB illisible : ${calendar.length} matchs trouvés (format de la page changé ?)`);

let fetched = 0;
const games = [];
for (const c of calendar) {
  const prev = known.get(c.id);
  const played = c.home.score != null && c.away.score != null && Date.parse(c.tipoff_utc) < Date.now();
  const g = { ...c, played, lines: prev?.lines ?? {}, validated: prev?.validated ?? false };
  // vidéo : lien du calendrier LFB, sinon celle déjà trouvée, sinon recherche sur la chaîne LFB TV
  const prevUrl = prev?.youtube?.url ?? null;
  g.youtube = c.youtube ? { url: c.youtube, kind: 'full', source: 'calendrier LFB' } : prevUrl ? prev.youtube : null;
  // matchs sans vidéo connus (config/site.json → no_video, ex. diffusion en panne) : pas de recherche
  if (played && !g.youtube && !config.no_video?.[c.id]) {
    try {
      const url = await findFullGame(c);
      if (url) g.youtube = { url, kind: 'full', source: 'recherche YouTube' };
    } catch (e) {
      errors.push(`Recherche YouTube ${c.home.name} – ${c.away.name} : ${e.message}`);
    }
  }
  // match validé dont le score n'a pas changé : rien à relire
  if (played && !(prev?.validated && prev.home.score === c.home.score && prev.away.score === c.away.score)) {
    try {
      const age = (Date.now() - Date.parse(c.tipoff_utc)) / 86400000;
      const data = await fetchJSON(`${LIVESTATS}/data/${c.id}/data.json`, { ttl: age > 2 ? 30 * 86400 : 0 });
      fetched++;
      const sum = (tno) => Object.values(data.tm?.[tno]?.pl ?? {}).reduce((a, p) => a + (Number(p.sPoints) || 0), 0);
      const ok = sum('1') === c.home.score && sum('2') === c.away.score
        && Number(data.tm?.['1']?.score) === c.home.score && Number(data.tm?.['2']?.score) === c.away.score;
      if (ok) {
        g.lines = lines(g, data);
        g.validated = true;
      } else {
        g.lines = {};
        g.validated = false;
        missing.push(`- J${c.round} ${c.date} ${c.home.name} – ${c.away.name} (${c.home.score}-${c.away.score}) : box score FIBA LiveStats `
          + `${sum('1')}-${sum('2')}, différent du score officiel (${c.links.livestats})`);
      }
    } catch (e) {
      errors.push(`FIBA LiveStats ${c.id} (${c.home.name} – ${c.away.name}) : ${e.message}`);
    }
  }
  games.push(g);
}

games.sort((a, b) => a.tipoff_utc.localeCompare(b.tipoff_utc) || a.id.localeCompare(b.id));
fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), season: '2026-27', games }, null, 1) + '\n');
fs.writeFileSync('data/missing-games.md', `# Matchs joués non publiés\n\nMis à jour le ${new Date().toISOString().slice(0, 10)}.\n\n`
  + (missing.length ? missing.join('\n') : 'Aucun : tous les matchs joués sont conformes au score officiel.') + '\n');

const played = games.filter((g) => g.played);
const noVideo = played.filter((g) => !g.youtube && !config.no_video?.[g.id]);
// Joueuses : toutes celles vues sur une feuille de match, avec leur club du dernier match
const byPlayer = new Map();
for (const g of games) {
  for (const l of Object.values(g.lines ?? {})) {
    const p = byPlayer.get(l.player_id) ?? { id: l.player_id, name: l.name, clubs: [], active: true };
    p.club = l.team;
    p.number = l.jersey;
    if (l.photo) p.photo = l.photo;
    if (l.position) p.position = l.position;
    if (!p.clubs.includes(l.team)) p.clubs.push(l.team);
    byPlayer.set(l.player_id, p);
  }
}
const players = [...byPlayer.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
fs.writeFileSync('data/players.json', JSON.stringify(players, null, 1) + '\n');
const tens = (st) => ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => st[k] >= 10).length;
const perfs = games.flatMap((g) => Object.values(g.lines ?? {})).filter((l) => l.stats && (l.stats.pts >= (config.highlight?.points ?? 20) || tens(l.stats) >= 2)).length;
console.log(`Calendrier : ${games.length} matchs · joués : ${played.length} · validés : ${played.filter((g) => g.validated).length}`
  + ` · sans vidéo : ${noVideo.length} · box scores relus : ${fetched} · joueuses : ${players.length} · lignes encadrées : ${perfs} · non publiés : ${missing.length} · erreurs : ${errors.length}`);
for (const e of errors) console.log(`  ! ${e}`);
