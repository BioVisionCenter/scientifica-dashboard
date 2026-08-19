/** Bilingual copy for TV-facing surfaces. German leads, English sublines.
    Operator pages (/admin, /explore) keep plain English literals. */

export interface Bi {
  de: string
  en: string
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
    enhanceTeaser: {
      de: 'Rohbild → verbessert: Rauschen entfernt, Kontrast verstärkt',
      en: 'raw → enhanced: denoised, contrast-stretched',
    },
    segTeaser: (n: number): Bi => ({
      de: `Die KI «cellpose» fand ${n.toLocaleString('de-CH')} Zellen — in Sekunden`,
      en: `the AI "cellpose" found ${n.toLocaleString('en-US')} cells — in seconds`,
    }),
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
