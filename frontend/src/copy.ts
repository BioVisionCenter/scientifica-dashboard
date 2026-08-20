/** Bilingual copy for TV-facing surfaces. German leads, English sublines.
    Operator pages (/admin, /explore) keep plain English literals. */

export interface Bi {
  de: string
  en: string
}

export type TvLang = 'de' | 'en' | 'bi'

/** One-line rendering of a bilingual string for the given TV language. */
export function biLine(t: Bi, lang: TvLang): string {
  if (lang === 'de') return t.de
  if (lang === 'en') return t.en
  return `${t.de} · ${t.en}`
}

export function ordinal(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`
  return `${n}th`
}

export const copy = {
  title: 'Cell Count Championship', // brand — not translated

  idle: {
    headline: { de: 'Wie viele Zellen siehst du?', en: 'How many cells do you see?' },
    cta: {
      de: 'Komm vorbei und spiel mit — schlag den Algorithmus!',
      en: 'Come play — beat the clock, beat the algorithm.',
    },
    champion: (name: string): Bi => ({
      de: `Aktueller Champion: ${name}`,
      en: `Current champion: ${name}`,
    }),
    beautyCaption: {
      de: 'Echte Zellen unter dem Mikroskop — Zellkerne in Cyan, Membranen in Magenta',
      en: 'Real cells under the microscope — nuclei in cyan, membranes in magenta',
    },
    segTeaser: (n: number): Bi => ({
      de: `Die KI «cellpose» fand ${n.toLocaleString('de-CH')} Zellen — in Sekunden`,
      en: `the AI "cellpose" found ${n.toLocaleString('en-US')} cells — in seconds`,
    }),
  },

  aboutData: {
    kicker: { de: 'Über die Daten', en: 'About the data' },
    headline: { de: 'Stammzellen auf dem Weg zum Herzmuskel', en: 'Stem cells becoming heart muscle' },
    body1: {
      de: 'Menschliche induzierte pluripotente Stammzellen differenzieren zu Herzmuskelzellen (Kardiomyozyten).',
      en: 'Human induced pluripotent stem cells differentiating into heart cells (cardiomyocytes).',
    },
    body2: {
      de: 'Fluoreszenzmikroskopie: Zellkerne in Cyan, Zellmembranen in Magenta.',
      en: 'Fluorescence microscopy: nuclei in cyan, cell membranes in magenta.',
    },
    credit: {
      de: 'Daten: Liberali-Labor · «Fractal» (Lüthi et al.) · BioVisionCenter, Universität Zürich',
      en: 'Data: Liberali lab · "Fractal" (Lüthi et al.) · BioVisionCenter, University of Zurich',
    },
  },

  aboutUs: {
    kicker: { de: 'Über uns', en: 'About us' },
    headline: { de: 'BioVisionCenter · Universität Zürich', en: 'BioVisionCenter · University of Zurich' },
    body1: {
      de: 'Das erste vollständig computergestützte akademische Zentrum der Schweiz für Forschung und Entwicklung in der Bildanalyse.',
      en: 'The first fully computational academic center dedicated to bioimage analysis R&D in Switzerland.',
    },
    body2: {
      de: 'Wir befähigen Biolog:innen, ihre Mikroskopie-Daten mit modernsten Machine-Vision-Methoden zu analysieren.',
      en: 'We empower biologists to analyze their bioimage datasets with state-of-the-art machine vision methods.',
    },
    credit: {
      de: 'Zuhause der Open-Source-Plattform Fractal — in Partnerschaft mit dem FMI',
      en: 'Home of the open-source Fractal platform — in partnership with FMI',
    },
  },

  howItWorks: {
    kicker: { de: 'So funktioniert das Spiel', en: 'How the game works' },
    step1: { de: 'Zähle die Zellen auf dem gedruckten Bild', en: 'Count the cells on the printed image' },
    step2: { de: 'Wir stoppen die Zeit', en: 'We time you' },
    step3: { de: 'Punkte = Genauigkeit × Tempo', en: 'Score = accuracy × speed' },
  },

  leaderboard: {
    heading: { de: 'Bestenliste', en: 'leaderboard' },
    scoring: { de: 'Punkte = Genauigkeit × Tempo', en: 'score = accuracy × speed' },
    empty: { de: 'Noch keine Einträge — spiel als Erste*r!', en: 'No entries yet — be the first to play' },
  },

  reveal: {
    truth: (t: number, g: number): Bi => ({
      de: `Es waren ${t} Zellen — du sagtest ${g}`,
      en: `the count was ${t} — you said ${g}`,
    }),
    rank: (r: number, total: number): Bi => ({
      de: `Platz ${r} von ${total}`,
      en: `${ordinal(r)} of ${total}`,
    }),
  },

  podium: {
    heading: { de: 'Endstand', en: 'final standings' },
  },

  status: {
    reconnecting: { de: 'Verbindung wird wiederhergestellt …', en: 'reconnecting…' },
    noData: {
      de: 'Keine Bilder gefunden — Pipeline zuerst ausführen',
      en: 'No derived images — run the pipeline first',
    },
  },
}
