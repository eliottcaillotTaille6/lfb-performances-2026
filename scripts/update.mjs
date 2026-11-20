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
const MIN_POINTS = config.highlight?.points ?? 20;

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

function tags(s) {
  const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => s[k] >= 10).length;
  return [s.pts >= MIN_POINTS ? `${s.pts} points` : null, tens >= 3 ? 'Triple-double' : tens === 2 ? 'Double-double' : null].filter(Boolean);
}

function performances(game, data) {
  const perfs = [];
  for (const [tno, side] of [['1', 'home'], ['2', 'away']]) {
    const team = data.tm?.[tno];
    for (const p of Object.values(team?.pl ?? {})) {
      const s = Object.fromEntries(Object.entries(STAT).map(([k, f]) => [k, k === 'min' ? Math.round(minutes(p[f]) * 10) / 10 : Number(p[f]) || 0]));
      const t = tags(s);
      if (!t.length) continue;
      const name = `${nameCase(p.firstName)} ${nameCase(p.familyName)}`.trim();
      perfs.push({
        player_id: slugify(name),
        name,
        jersey: String(p.shirtNumber ?? ''),
        side,
        team: game[side].name,
        team_code: game[side].code,
        starter: !!Number(p.starter),
        photo: p.photoT || p.photoS || null,
        stats: s,
        tags: t,
      });
    }
  }
  return perfs.sort((a, b) => b.stats.pts - a.stats.pts || b.stats.reb - a.stats.reb);
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
  const g = { ...c, played, perfs: prev?.perfs ?? [], validated: prev?.validated ?? false };
  // vidéo : lien du calendrier LFB, sinon celle déjà trouvée, sinon recherche sur la chaîne LFB TV
  g.youtube_source = c.youtube ? 'lfb' : prev?.youtube ? prev.youtube_source : null;
  g.youtube = c.youtube ?? prev?.youtube ?? null;
  if (played && !g.youtube) {
    try {
      g.youtube = await findFullGame(c);
      if (g.youtube) g.youtube_source = 'youtube';
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
        g.perfs = performances(g, data);
        g.validated = true;
      } else {
        g.perfs = [];
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
const noVideo = played.filter((g) => !g.youtube);
const perfs = games.reduce((a, g) => a + g.perfs.length, 0);
console.log(`Calendrier : ${games.length} matchs · joués : ${played.length} · validés : ${played.filter((g) => g.validated).length}`
  + ` · sans vidéo : ${noVideo.length} · box scores relus : ${fetched} · performances : ${perfs} · non publiés : ${missing.length} · erreurs : ${errors.length}`);
for (const e of errors) console.log(`  ! ${e}`);
