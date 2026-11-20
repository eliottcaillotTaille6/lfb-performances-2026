// Match complet sur la chaîne LFB TV (@BasketLFBTV), quand le calendrier LFB ne donne pas encore le lien.
// Titres : « [REPLAY] Landerneau - Charnay | J06 La Boulangère Wonderligue 2026-2027 »,
//          « [LIVE] Angers vs. Charleville-Mézières | Round 8 La Boulangère Wonderligue 2026-2027 ».
// Une vidéo n'est retenue que si :
// - elle est publiée par la chaîne LFB TV ;
// - c'est un match complet ([REPLAY] ou [LIVE], au moins 45 min) de la saison 2026-2027 ;
// - la journée du titre est celle du match (J06, Round 6, Matchday 6, Day 6, Week 6) ;
// - l'équipe à domicile est citée en premier et les deux noms correspondent.
import { fetchText } from './http.mjs';

const plain = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const GENERIC = new Set(['basket', 'basketball', 'club', 'bc', 'de', 'la', 'le', 'les']);
const words = (s) => plain(s).split(' ').filter((w) => w.length >= 2 && !GENERIC.has(w));

export function similarity(a, b) {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (!wa.size || !wb.size) return 0;
  return [...wa].filter((w) => wb.has(w)).length / Math.min(wa.size, wb.size);
}

const seconds = (t) => (/^\d+(:\d{2}){1,2}$/.test(t ?? '') ? t.split(':').reduce((a, x) => a * 60 + Number(x), 0) : null);

function results(html) {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) return [];
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const v = o.videoRenderer;
    if (v) {
      out.push({
        id: v.videoId,
        title: (v.title?.runs ?? []).map((r) => r.text).join(''),
        channel: v.ownerText?.runs?.[0]?.text ?? '',
        duration_s: seconds(v.lengthText?.simpleText),
      });
    }
    Object.values(o).forEach(walk);
  };
  walk(JSON.parse(m[1]));
  return out;
}

export function isFullGameOf(v, game) {
  if (!/^LFB TV/i.test(v.channel)) return false;
  if (!/^\[(REPLAY|LIVE)\]/i.test(v.title) || !/2026-2027/.test(v.title)) return false;
  if (!v.duration_s || v.duration_s < 45 * 60) return false;
  const [teams, rest = ''] = v.title.replace(/^\[[^\]]*\]\s*/, '').split('|');
  const round = /\b(?:J|Round|Matchday|Day|Week)\s*0*(\d+)\b/i.exec(rest)?.[1];
  if (Number(round) !== game.round) return false;
  const [home, away] = teams.split(/\s+(?:-|vs\.?|v)\s+/i);
  return similarity(home, game.home.name) >= 0.5 && similarity(away ?? '', game.away.name) >= 0.5;
}

export async function findFullGame(game) {
  const query = `[REPLAY] ${game.home.name} ${game.away.name} La Boulangère Wonderligue 2026-2027`;
  const html = await fetchText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
    ttl: 1800,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.8', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
  });
  const hit = results(html).find((v) => isFullGameOf(v, game));
  return hit ? `https://www.youtube.com/watch?v=${hit.id}` : null;
}
