// Onglet Session : préparation, début/pause/fin de session, test guidé, analyse manuelle.
import { analyzeText, newId } from '../../core/analyze';
import { offerFromAnalysis } from '../../core/history';
import { sessionMinutes } from '../../core/aggregate';
import { VERDICT_LABEL } from '../../core/verdict';
import type { Analysis } from '../../core/types';
import type { OfferRec, SessionRec } from '../../core/domain';
import { state, currentFastConfig, activeCost, activeThreshold } from '../state';
import { esc, eur, num, dt, dur, toast, copy, parseInput, VERDICT_CLASS } from '../ui';

export async function openSession(): Promise<SessionRec | null> {
  const all = await state.db.all('sessions');
  return all.find((s) => !s.endedAt) ?? null;
}

export function resultCard(a: Analysis, opts: { fictive?: boolean } = {}): string {
  const v = a.verdict;
  const f = a.finance;
  return `<div class="result ${VERDICT_CLASS[v.verdict]}" role="status">
    <div class="result-title">${esc(a.display.title)}</div>
    <div class="result-body">${esc(a.display.body)}</div>
    ${opts.fictive ? '<div class="tag-fictive">Exemple fictif</div>' : ''}
    <dl class="kv">
      <dt>Recette P</dt><dd>${eur(f.P)}${f.pIsUpperBound ? ' <small>(base non confirmée)</small>' : ''}</dd>
      <dt>Distance / durée</dt><dd>${num(f.D, 1)} km · ${num(f.T, 0)} min</dd>
      <dt>Recette</dt><dd>${num(f.revenuePerKm)} €/km · ${num(f.revenuePerHour)} €/h</dd>
      <dt>Marge estimée</dt><dd>${eur(f.margin)} · ${num(f.marginPerKm)} €/km · ${num(f.marginPerHour)} €/h${f.marginExcludesOther ? ' <small>(hors autres frais E, non renseignés)</small>' : ''}${f.margin === null ? ' <small>(coûts ou données manquants)</small>' : ''}</dd>
    </dl>
    ${v.reasons.length ? `<p class="muted">${esc(v.reasons.join(' · '))}</p>` : ''}
  </div>`;
}

const FICTIVE = [
  (p: number, a: number, am: number, t: number, tm: number) => `UberX\n${num(p)} €\nÀ ${am} min (${num(a, 1)} km)\nTrajet de ${tm} min (${num(t, 1)} km)\nAccepter`,
  (p: number, a: number, am: number, t: number, tm: number) => `Bolt\n${num(p)} €\nPrise en charge · ${am} min · ${num(a, 1)} km\nDestination · ${tm} min · ${num(t, 1)} km\nAccepter`,
];

export async function renderSession(root: HTMLElement) {
  const sess = await openSession();
  const { config, missing, warnings } = await currentFastConfig();
  const lastExported = await state.db.meta<string>('lastExportedConfigId');
  const offers = (await state.db.all('offers')).sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1)).slice(0, 5);
  const pastSessions = (await state.db.all('sessions')).filter((x) => x.endedAt).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, 10);
  const cost = await activeCost();
  const th = await activeThreshold();
  const steps = [
    { ok: !!cost, label: 'Véhicule et coûts', href: '#/reglages/couts' },
    { ok: !!th, label: 'Seuils', href: '#/reglages/seuils' },
    { ok: state.settings.platforms.uber.confirmed && state.settings.platforms.bolt.confirmed, label: 'Base des prix Uber / Bolt', href: '#/reglages/plateformes' },
    { ok: !!config && lastExported === config.configId, label: 'Raccourci configuré avec la version actuelle', href: '#/reglages/raccourci' },
  ];
  const now = new Date();
  const active = sess ? sessionMinutes(sess, now) : 0;
  const paused = sess?.pauses.some((p) => !p.end);

  root.innerHTML = `
  <section class="card">
    <h2>Préparation</h2>
    <ol class="checklist">${steps.map((s) => `<li class="${s.ok ? 'ok' : 'todo'}"><span aria-hidden="true">${s.ok ? '✓' : '○'}</span> <a href="${s.href}">${esc(s.label)}</a> <span class="sr-only">${s.ok ? 'fait' : 'à faire'}</span></li>`).join('')}</ol>
    ${missing.length ? `<p class="warn">Manquant : ${esc(missing.join(', '))}</p>` : ''}
    ${warnings.length ? `<details><summary>${warnings.length} point(s) d'attention</summary><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    ${config ? `<p class="muted">Configuration actuelle <code>${esc(config.configId)}</code>${lastExported === config.configId ? ' : à jour dans le raccourci' : ' : <strong>à réimporter dans Scriptable</strong>'}</p>
      <button class="btn" data-act="copy-config">Copier la configuration</button>` : ''}
    <button class="btn secondary" data-act="guided-test" ${config ? '' : 'disabled'}>Test guidé à l'arrêt</button>
  </section>

  <section class="card">
    <h2>Session de travail</h2>
    ${
      sess
        ? `<p><strong>${paused ? 'En pause' : 'En cours'}</strong> depuis ${dt(sess.startedAt)} · temps actif ${dur(active)}</p>
           <div class="row">
             ${paused ? '<button class="btn" data-act="resume">Reprendre</button>' : '<button class="btn secondary" data-act="pause">Pause</button>'}
             <label class="inline">Compteur fin (km) <input inputmode="decimal" id="odoEnd" class="small"></label>
             <button class="btn danger" data-act="stop">Terminer</button>
           </div>`
        : `<p class="muted">Aucune session. Le temps d'activité (attente comprise) sert au taux horaire réel des bilans.</p>
           <div class="row"><label class="inline">Compteur début (km) <input inputmode="decimal" id="odoStart" class="small"></label>
           <button class="btn" data-act="start">Démarrer</button></div>`
    }
    <p class="muted small">Les horodatages sont enregistrés : la durée reste juste même si l'application est fermée ou suspendue.</p>
  </section>

  <section class="card">
    <h2>Analyser un texte d'offre</h2>
    <p class="muted small">Diagnostic : collez un texte (par exemple copié avec Texte en direct depuis une capture). Le parcours de conduite passe par le raccourci.</p>
    <label for="ocrText" class="sr-only">Texte de l'offre</label>
    <textarea id="ocrText" rows="5" placeholder="UberX&#10;12,50 €&#10;À 6 min (2,0 km)&#10;Trajet de 20 min (8,0 km)"></textarea>
    <div class="row"><button class="btn" data-act="analyze" ${config ? '' : 'disabled'}>Analyser</button></div>
    <div id="manualResult"></div>
  </section>

  <section class="card">
    <h2>Sessions terminées</h2>
    ${pastSessions.length ? `<ul class="list">${pastSessions.map((x) => `<li class="line"><span>${dt(x.startedAt)} → ${dt(x.endedAt)}</span><span class="right">${dur(sessionMinutes(x))}</span><button class="btn tiny danger" data-del-session="${esc(x.id)}" aria-label="Supprimer la session">Supprimer</button></li>`).join('')}</ul>` : '<p class="muted">Aucune session terminée.</p>'}
  </section>

  <section class="card">
    <h2>Dernières analyses</h2>
    ${offers.length ? `<ul class="list">${offers.map(offerLine).join('')}</ul>` : '<p class="muted">Aucune analyse. Importez le journal du raccourci (Réglages > Données) ou synchronisez.</p>'}
  </section>`;

  let lastManual: Analysis | null = null;
  root.onclick = async (ev) => {
    const del = (ev.target as HTMLElement).closest('[data-del-session]') as HTMLElement | null;
    if (del && confirm('Supprimer cette session ? Son temps ne sera plus compté dans les bilans.')) {
      await state.db.remove('sessions', del.dataset.delSession!);
      toast('Session supprimée', 'ok');
      return renderSession(root);
    }
    const b = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'copy-config' && config) {
      if (await copy(JSON.stringify(config))) {
        await state.db.setMeta('lastExportedConfigId', config.configId);
        toast('Configuration copiée. Dans Scriptable : VTC Perso > Importer la configuration.', 'ok');
        renderSession(root);
      } else toast('Copie impossible : utilisez Réglages > Raccourci', 'err');
    }
    if (act === 'start') {
      const odo = parseInput((document.getElementById('odoStart') as HTMLInputElement).value);
      const s: SessionRec = { id: newId(), updatedAt: '', startedAt: new Date().toISOString(), endedAt: null, pauses: [], vehicleId: state.settings.activeVehicleId, odoStart: odo !== null && !Number.isNaN(odo) ? odo : null, odoEnd: null, platformFocus: state.settings.sessionPlatform };
      await state.db.save('sessions', s);
      toast('Session démarrée', 'ok');
      renderSession(root);
    }
    if (act === 'pause' && sess) {
      await state.db.save('sessions', { ...sess, pauses: [...sess.pauses, { start: new Date().toISOString(), end: null }] });
      renderSession(root);
    }
    if (act === 'resume' && sess) {
      const pauses = sess.pauses.map((p) => (p.end ? p : { ...p, end: new Date().toISOString() }));
      await state.db.save('sessions', { ...sess, pauses });
      renderSession(root);
    }
    if (act === 'stop' && sess) {
      const odo = parseInput((document.getElementById('odoEnd') as HTMLInputElement).value);
      const end = new Date().toISOString();
      if (odo !== null && !Number.isNaN(odo) && sess.odoStart !== null && odo < sess.odoStart) return toast('Compteur de fin inférieur au début', 'err');
      const pauses = sess.pauses.map((p) => (p.end ? p : { ...p, end }));
      await state.db.save('sessions', { ...sess, pauses, endedAt: end, odoEnd: odo !== null && !Number.isNaN(odo) ? odo : null });
      toast(`Session terminée : ${dur(sessionMinutes({ ...sess, pauses, endedAt: end }))} d'activité`, 'ok');
      renderSession(root);
    }
    if (act === 'analyze' && config) {
      const t = (document.getElementById('ocrText') as HTMLTextAreaElement).value;
      lastManual = analyzeText(t, config, { source: 'manual' });
      document.getElementById('manualResult')!.innerHTML =
        resultCard(lastManual) + `<button class="btn secondary" data-act="save-manual">Enregistrer dans l'historique</button>`;
    }
    if (act === 'save-manual' && lastManual) {
      const o: OfferRec = offerFromAnalysis(lastManual, sess?.id ?? null);
      await state.db.save('offers', o, { keepTimestamp: true });
      toast('Analyse enregistrée', 'ok');
      lastManual = null;
      renderSession(root);
    }
    if (act === 'guided-test' && config) guidedTest(config);
  };
}

function offerLine(o: OfferRec): string {
  const a = o.corrected ?? o.original;
  return `<li><a href="#/offre/${encodeURIComponent(o.id)}" class="line">
    <span class="badge ${VERDICT_CLASS[a.verdict.verdict]}">${esc(VERDICT_LABEL[a.verdict.verdict])}</span>
    <span>${esc(o.platform === 'unknown' ? '?' : o.platform.toUpperCase())} · ${dt(o.capturedAt)}</span>
    <span class="right">${a.verdict.perHour !== null ? num(a.verdict.perHour) + ' €/h' : a.verdict.perKm !== null ? num(a.verdict.perKm) + ' €/km' : '—'}</span></a></li>`;
}
export { offerLine };

/** Écran plein d'une offre FICTIVE : l'utilisateur déclenche AssistiveTouch et compare au résultat attendu. */
function guidedTest(config: NonNullable<Awaited<ReturnType<typeof currentFastConfig>>['config']>) {
  const r = (lo: number, hi: number, d = 1) => Math.round((lo + Math.random() * (hi - lo)) * 10 ** d) / 10 ** d;
  const kind = Math.random() < 0.5 ? 0 : 1;
  const a = r(0.5, 4), t = r(3, 25);
  const am = Math.max(1, Math.round(a * 2.5)), tm = Math.max(3, Math.round(t * 2));
  const p = r(8, 45, 2);
  const text = FICTIVE[kind](p, a, am, t, tm);
  const expected = analyzeText(text, config, { source: 'demo' });
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Test guidé');
  ov.innerHTML = `<div class="fake-offer">${text.split('\n').map((l, i) => `<div class="${i === 1 ? 'fake-price' : ''}">${esc(l)}</div>`).join('')}</div>
    <p class="fake-note">OFFRE FICTIVE DE TEST · appuyez sur AssistiveTouch maintenant, puis comparez la notification au résultat attendu.</p>
    <div class="row"><button class="btn secondary" data-x="reveal">Afficher le résultat attendu</button><button class="btn" data-x="close">Fermer</button></div>
    <div id="expected" hidden>${resultCard(expected, { fictive: true })}</div>`;
  ov.onclick = (e) => {
    const x = (e.target as HTMLElement).dataset.x;
    if (x === 'close') ov.remove();
    if (x === 'reveal') (ov.querySelector('#expected') as HTMLElement).hidden = false;
  };
  document.body.appendChild(ov);
}
