# Les perfs de La Boulangère Wonderligue

Site statique qui liste, journée par journée, les performances de La Boulangère Wonderligue (LFB, saison 2026-27) à
**20 points ou plus, ou en double-double** (triple-double compris), pour **toutes les joueuses** du championnat.
Il se met à jour les soirs de LFB grâce à une GitHub Action, puis se redéploie sur GitHub Pages.

Site : <https://eliottcaillottaille6.github.io/lfb-performances-2026/> (une fois le dépôt publié)

## Comment ça marche

```
basketlfb.com (calendrier) ──► scripts/update.mjs ──► data/games.json ──► site (public/)
FIBA LiveStats FFBB (feuilles de match) ┘    └─► data/missing-games.md (matchs non publiés)
YouTube LFB TV (@BasketLFBTV) ──────────┘
```

- **Calendrier** : la page officielle <https://basketlfb.com/laboulangerewonderligue/saison-reguliere/calendrier>
  donne les 132 matchs de la saison régulière : date et heure, journée, équipes et logos, score, lien vers la feuille
  de match FIBA LiveStats de la FFBB et, une fois le match diffusé, sa vidéo YouTube (le match complet, « [REPLAY] »).
- **Stats** : la feuille de match FIBA LiveStats (`fibalivestats.dcd.shared.geniussports.com/data/<id>/data.json`)
  donne le box score officiel de chaque joueuse. Un match n'est publié que si les points des joueuses de chaque équipe
  égalent le score du calendrier LFB et celui de la feuille ; sinon il est listé dans `data/missing-games.md`.
  Vérifié au lancement (20 novembre 2026) : 46 matchs joués sur 46 conformes, 54 performances.
- **Performance retenue** : au moins 20 points (`config/site.json` → `highlight.points`), ou au moins 10 dans deux
  catégories parmi points, rebonds, passes, interceptions et contres (double-double ; trois = triple-double).
- **Vidéo** : le lien du calendrier LFB, sinon une recherche YouTube (`scripts/lib/youtube.mjs`), retenue seulement si
  la vidéo vient de la chaîne LFB TV, est un match complet ([REPLAY] ou [LIVE], 45 min au moins) de la saison 2026-2027,
  de la bonne journée, avec l'équipe à domicile citée en premier.
- **Joueuses** : FIBA LiveStats ne donne pas d'identifiant stable ; une joueuse est reconnue par son nom (prénom + nom).
  Sa photo vient de la feuille de match.
- Les feuilles des matchs validés sont gardées 30 jours en cache (`.cache/http`) : une mise à jour ne relit que les
  nouveaux matchs. Requêtes espacées d'une seconde (`HTTP_DELAY_MS`).

## Pages

- **Dernière journée** (accueil) : les performances de la journée, classées par points, avec photo, ligne de stats,
  badges (20 points, double-double, triple-double) et liens ; puis les matchs de la journée (score, feuille de match,
  fiche LFB, match complet). Boutons journée précédente / suivante.
- **Joueuses** : toutes les joueuses qui ont au moins une performance, triables (nombre de perfs, 20 points et plus,
  double-doubles, record).
- **Fiche joueuse** : ses performances de la saison.

## Mode éditeur, Actualiser et Clipper

Ouvrir une fois le site avec `?admin` : le mode éditeur reste actif sur cet appareil (`?admin=0` pour l'enlever).

- **Actualiser** : ouvre la page GitHub de l'Action (« Run workflow »), puis le site se recharge tout seul.
- **Clipper** sur chaque performance dont le match complet est sur YouTube : ouvre l'outil de clipping du Mac avec le
  match complet, la feuille de match **FIBA LiveStats** comme play-by-play, le nom, le numéro, l'équipe (1 = à
  domicile) et `zones=lfb` (habillage de la Wonderligue : quart-temps, chrono, scores), puis l'analyse est lancée.
  **Clipper passes** en plus quand la joueuse a 10 passes décisives ou plus.

## Mises à jour

Mercredi à 23 h, samedi à 23 h 10, dimanche à 17 h 40 (heure de Paris). C'est le Mac de l'éditeur qui les lance
(agent `com.clipspaniers.prefetch-lfb` de l'outil de clipping, installé par `install.py`) : il déclenche l'Action,
attend la publication, télécharge les matchs complets des performances dans le dossier des vidéos et lance leur
analyse. Les horaires programmés sur GitHub (`.github/workflows/update.yml`, souvent en retard) restent en secours.

## Commandes

```bash
npm run update    # calendrier, feuilles de match, vidéos
npm run build     # assemble le site dans _site/
npm run dev       # site local sur http://localhost:4321 (variable PORT pour changer)
```

## Points d'attention

- La page calendrier de basketlfb.com et les feuilles FIBA LiveStats ne sont pas des API documentées : si leur format
  change, `update.mjs` s'arrête avec une erreur (moins de 100 matchs lus) plutôt que de publier des chiffres faux.
- Une même joueuse écrite différemment sur deux feuilles de match aurait deux fiches.
- Landerneau – Chartres (J8) n'a pas de vidéo au lancement : rien n'a été publié sur la chaîne LFB TV.
