/** Multilingual copy for TV-facing surfaces (Swiss official languages + EN).
    Operator pages (/admin) keep plain English literals. */

export interface Bi {
  de: string
  en: string
  it: string
  fr: string
}

export const SINGLE_LANGS = ['de', 'en', 'it', 'fr'] as const
export type SingleLang = (typeof SINGLE_LANGS)[number]

/** Server-held language mode. 'bi' = German lead + English subline;
    'rotate' cycles through the four single languages. */
export type TvLang = SingleLang | 'bi' | 'rotate'

/** A display-resolved language: 'rotate' has already been resolved. */
export type DisplayLang = SingleLang | 'bi'

/** One-line rendering for a resolved display language. */
export function biLine(t: Bi, lang: DisplayLang): string {
  if (lang === 'bi') return `${t.de} · ${t.en}`
  return t[lang]
}

export function ordinal(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`
  return `${n}th`
}

function frOrdinal(n: number): string {
  return n === 1 ? '1er' : `${n}e`
}

export const copy = {
  title: 'Cell Count Championship', // brand — not translated

  idle: {
    headline: {
      de: 'Wie viele Zellen siehst du?',
      en: 'How many cells do you see?',
      it: 'Quante cellule vedi?',
      fr: 'Combien de cellules vois-tu ?',
    },
    cta: {
      de: 'Komm vorbei und spiel mit — schlag den Algorithmus!',
      en: 'Come play — beat the clock, beat the algorithm.',
      it: 'Vieni a giocare — batti il tempo, batti l’algoritmo!',
      fr: 'Viens jouer — bats le chrono, bats l’algorithme !',
    },
    champion: (name: string): Bi => ({
      de: `Aktueller Champion: ${name}`,
      en: `Current champion: ${name}`,
      it: `Campione attuale: ${name}`,
      fr: `Champion actuel : ${name}`,
    }),
    segTeaser: (n: number, seconds: number | null): Bi => {
      // fall back to the generic wording when no benchmarked time exists
      const t = (locale: string) =>
        seconds !== null ? `in ${seconds.toLocaleString(locale)} s` : null
      return {
        de: `Die KI «cellpose» fand ${n.toLocaleString('de-CH')} Zellen — ${t('de-CH') ?? 'in Sekunden'}`,
        en: `the AI "cellpose" found ${n.toLocaleString('en-US')} cells — ${t('en-US') ?? 'in seconds'}`,
        it: `L'IA «cellpose» ha trovato ${n.toLocaleString('it-CH')} cellule — ${t('it-CH') ?? 'in pochi secondi'}`,
        fr: `L'IA « cellpose » a trouvé ${n.toLocaleString('fr-CH')} cellules — ${t('fr-CH') ?? 'en quelques secondes'}`,
      }
    },
    cellsLabel: { de: 'Zellen', en: 'cells', it: 'cellule', fr: 'cellules' },
  },

  aboutData: {
    kicker: { de: 'Über die Daten', en: 'About the data', it: 'I dati', fr: 'Les données' },
    headline: {
      de: 'Stammzellen auf dem Weg zum Herzmuskel',
      en: 'Stem cells becoming heart muscle',
      it: 'Cellule staminali che diventano muscolo cardiaco',
      fr: 'Des cellules souches qui deviennent du muscle cardiaque',
    },
    body1: {
      de: 'Menschliche induzierte pluripotente Stammzellen differenzieren zu Herzmuskelzellen (Kardiomyozyten).',
      en: 'Human induced pluripotent stem cells differentiating into heart cells (cardiomyocytes).',
      it: 'Cellule staminali pluripotenti indotte umane che si differenziano in cellule cardiache (cardiomiociti).',
      fr: 'Des cellules souches pluripotentes induites humaines se différencient en cellules cardiaques (cardiomyocytes).',
    },
    body2: {
      de: 'Fluoreszenzmikroskopie: Zellkerne in Cyan, Zellmembranen in Magenta.',
      en: 'Fluorescence microscopy: nuclei in cyan, cell membranes in magenta.',
      it: 'Microscopia a fluorescenza: nuclei in ciano, membrane cellulari in magenta.',
      fr: 'Microscopie à fluorescence : noyaux en cyan, membranes cellulaires en magenta.',
    },
    credit: {
      de: 'Daten: BioVisionCenter, Universität Zürich — aus «Fractal» (Lüthi et al., bioRxiv 2026)',
      en: 'Data: BioVisionCenter, University of Zurich — from "Fractal" (Lüthi et al., bioRxiv 2026)',
      it: 'Dati: BioVisionCenter, Università di Zurigo — da «Fractal» (Lüthi et al., bioRxiv 2026)',
      fr: 'Données : BioVisionCenter, Université de Zurich — tirées de « Fractal » (Lüthi et al., bioRxiv 2026)',
    },
  },

  aboutUs: {
    kicker: { de: 'Über uns', en: 'About us', it: 'Chi siamo', fr: 'Qui sommes-nous' },
    headline: {
      de: 'BioVisionCenter · Universität Zürich',
      en: 'BioVisionCenter · University of Zurich',
      it: 'BioVisionCenter · Università di Zurigo',
      fr: 'BioVisionCenter · Université de Zurich',
    },
    body1: {
      de: 'Das erste vollständig computergestützte akademische Zentrum der Schweiz für Forschung und Entwicklung in der Bildanalyse.',
      en: 'The first fully computational academic center dedicated to bioimage analysis R&D in Switzerland.',
      it: 'Il primo centro accademico interamente computazionale in Svizzera dedicato alla ricerca e sviluppo nell’analisi di bioimmagini.',
      fr: 'Le premier centre académique entièrement computationnel de Suisse dédié à la R&D en analyse de bio-images.',
    },
    body2: {
      de: 'Wir befähigen Biolog:innen, ihre Mikroskopie-Daten mit modernsten Machine-Vision-Methoden zu analysieren.',
      en: 'We empower biologists to analyze their bioimage datasets with state-of-the-art machine vision methods.',
      it: 'Aiutiamo i biologi ad analizzare i loro dati di microscopia con metodi di visione artificiale all’avanguardia.',
      fr: 'Nous permettons aux biologistes d’analyser leurs données de microscopie avec des méthodes de vision par ordinateur de pointe.',
    },
    credit: {
      de: 'Zuhause der Open-Source-Plattform Fractal',
      en: 'Home of the open-source Fractal platform',
      it: 'Casa della piattaforma open source Fractal',
      fr: 'Berceau de la plateforme open source Fractal',
    },
  },

  howItWorks: {
    kicker: {
      de: 'So funktioniert das Spiel',
      en: 'How the game works',
      it: 'Come funziona il gioco',
      fr: 'Comment fonctionne le jeu',
    },
    step1: {
      de: 'Zähle die Zellen auf dem Bildschirm',
      en: 'Count the cells on the screen',
      it: 'Conta le cellule sullo schermo',
      fr: 'Compte les cellules à l’écran',
    },
    step2: { de: 'Wir stoppen die Zeit', en: 'We time you', it: 'Cronometriamo il tempo', fr: 'Nous chronométrons' },
    step3: {
      de: 'Punkte = Genauigkeit × Tempo',
      en: 'Score = accuracy × speed',
      it: 'Punteggio = precisione × velocità',
      fr: 'Score = précision × vitesse',
    },
  },

  game: {
    heading: {
      de: 'Zähl die Zellen!',
      en: 'Count the cells!',
      it: 'Conta le cellule!',
      fr: 'Compte les cellules !',
    },
    getReady: {
      de: 'Mach dich bereit …',
      en: 'Get ready…',
      it: 'Preparati…',
      fr: 'Prépare-toi…',
    },
    counting: {
      de: 'Die Zeit läuft',
      en: 'The clock is running',
      it: 'Il tempo scorre',
      fr: 'Le chrono tourne',
    },
    stopped: {
      de: 'Zeit gestoppt',
      en: 'Time stopped',
      it: 'Tempo fermato',
      fr: 'Chrono arrêté',
    },
  },

  leaderboard: {
    heading: { de: 'Bestenliste', en: 'leaderboard', it: 'classifica', fr: 'classement' },
    scoring: {
      de: 'Punkte = Genauigkeit × Tempo',
      en: 'score = accuracy × speed',
      it: 'punteggio = precisione × velocità',
      fr: 'score = précision × vitesse',
    },
    empty: {
      de: 'Noch keine Einträge — spiel als Erste*r!',
      en: 'No entries yet — be the first to play',
      it: 'Nessun risultato — gioca per primo!',
      fr: 'Aucun résultat — sois le premier à jouer !',
    },
  },

  reveal: {
    truth: (t: number, g: number): Bi => ({
      de: `Es waren ${t} Zellen — du sagtest ${g}`,
      en: `the count was ${t} — you said ${g}`,
      it: `Erano ${t} cellule — tu hai detto ${g}`,
      fr: `Il y avait ${t} cellules — tu as dit ${g}`,
    }),
    rank: (r: number, total: number): Bi => ({
      de: `Platz ${r} von ${total}`,
      en: `${ordinal(r)} of ${total}`,
      it: `${r}° su ${total}`,
      fr: `${frOrdinal(r)} sur ${total}`,
    }),
  },

  podium: {
    heading: { de: 'Endstand', en: 'final standings', it: 'classifica finale', fr: 'classement final' },
  },

  status: {
    reconnecting: {
      de: 'Verbindung wird wiederhergestellt …',
      en: 'reconnecting…',
      it: 'riconnessione in corso…',
      fr: 'reconnexion en cours…',
    },
    noData: {
      de: 'Keine Bilder gefunden — Pipeline zuerst ausführen',
      en: 'No derived images — run the pipeline first',
      it: 'Nessuna immagine trovata — eseguire prima la pipeline',
      fr: 'Aucune image trouvée — lancer d’abord la pipeline',
    },
  },
}
