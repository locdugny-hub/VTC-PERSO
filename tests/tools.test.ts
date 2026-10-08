import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS sans types
import { parseCsv, report } from '../tools/latency-report.mjs';

describe('Rapport de latence (annotations vidéo)', () => {
  it('convertit images -> ms, retient la première restitution utile, compte les échecs', () => {
    const rows = parseCsv('essai;plateforme;etat;fps;image_pression;image_visible;image_voix;offre_encore_affichee;verdict_correct\n1;uber;froid;240;100;520;400;oui;oui\n2;uber;chaud;240;0;240;;oui;oui\n3;uber;chaud;240;0;;;non;non');
    const r = report(rows);
    expect(r['uber/froid'].mediane_ms).toBe(1250); // voix à 300 images = 1250 ms, avant la bannière
    expect(r['uber/chaud'].mediane_ms).toBe(1000);
    expect(r['uber/chaud'].sans_resultat).toBe(1);
    expect(r['tous/tous'].cible_95pct_2s).toBe(false); // un essai sans résultat compte comme un échec
    expect(r['tous/tous'].offre_disparue_avant_resultat).toBe(1);
  });
});
