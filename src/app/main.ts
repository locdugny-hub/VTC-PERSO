// Point d'entrée de la PWA VTC Perso.
import './styles.css';
import { state, openScope, storedScope, rememberScope } from './state';
import { renderSession } from './views/session';
import { renderHistory, renderOffer } from './views/history';
import { renderBilan } from './views/bilan';
import { renderSettings } from './views/settings';
import { sb, currentUser } from './cloud';
import { esc, toast } from './ui';
import { LocalDB } from './db';

const TABS: [string, string, string][] = [
  ['session', 'Session', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2'],
  ['historique', 'Historique', 'M4 6h16M4 12h16M4 18h10'],
  ['bilan', 'Bilan', 'M5 20V10m7 10V4m7 16v-7'],
  ['reglages', 'Réglages', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z'],
];

function shell() {
  document.getElementById('app')!.innerHTML = `
  <header class="top">
    <div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true" class="logo"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M8 23 14 9h4l6 14" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="m12.5 18 2.5 2.5 5-5.5" stroke="#F5B942" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span>VTC Perso</span></div>
    <div id="status" class="status" aria-live="polite"></div>
  </header>
  <div id="banner"></div>
  <main id="view" tabindex="-1"></main>
  <nav class="tabs" aria-label="Navigation principale">${TABS.map(([k, l, d]) => `<a href="#/${k}" data-tab="${k}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${l}</span></a>`).join('')}</nav>`;
}

function updateStatus() {
  const el = document.getElementById('status');
  if (!el) return;
  const parts = [navigator.onLine ? '' : 'Hors connexion', state.scope === 'demo' ? 'DÉMO FICTIVE' : state.userEmail ? 'Synchronisable' : 'Local'];
  el.textContent = parts.filter(Boolean).join(' · ');
  const b = document.getElementById('banner')!;
  b.innerHTML = state.scope === 'demo' ? '<div class="banner demo">Démonstration : toutes les données affichées sont fictives.</div>' : '';
}

async function route() {
  const view = document.getElementById('view')!;
  const [, tab = 'session', arg] = location.hash.replace(/^#/, '').split('/');
  document.querySelectorAll('.tabs a').forEach((a) => {
    const on = (a as HTMLElement).dataset.tab === (tab === 'offre' ? 'historique' : tab);
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  // Chaque navigation rend dans un conteneur neuf : un rendu asynchrone tardif d'une page
  // précédente écrit dans un conteneur détaché et ne peut pas écraser la page actuelle.
  const host = document.createElement('div');
  view.replaceChildren(host);
  try {
    if (tab === 'historique') await renderHistory(host);
    else if (tab === 'offre' && arg) await renderOffer(host, decodeURIComponent(arg));
    else if (tab === 'bilan') await renderBilan(host);
    else if (tab === 'reglages') await renderSettings(host, arg);
    else await renderSession(host);
  } catch (e) {
    host.innerHTML = `<section class="card"><p class="warn">Erreur d'affichage : ${esc((e as Error).message)}</p></section>`;
  }
  updateStatus();
  view.focus({ preventScroll: true });
}

async function boot() {
  shell();
  let scope = storedScope();
  const user = await currentUser().catch(() => null);
  if (user) {
    state.userId = user.id;
    state.userEmail = user.email;
    scope = scope === 'demo' ? 'demo' : 'u-' + user.id;
  } else if (scope.startsWith('u-')) scope = 'local';
  try {
    await openScope(scope);
  } catch {
    document.getElementById('view')!.innerHTML = '<section class="card"><p class="warn">Stockage local indisponible (navigation privée ?). Les données ne peuvent pas être enregistrées.</p></section>';
    return;
  }
  rememberScope(scope);
  sb()?.auth.onAuthStateChange(async (ev, session) => {
    if (ev === 'SIGNED_OUT' && state.userId) {
      // Retour à l'espace local : les données du compte restent séparées sur l'appareil.
      state.userId = null;
      state.userEmail = null;
      if (state.scope !== 'demo') {
        await openScope('local');
        rememberScope('local');
      }
      route();
      return;
    }
    if (ev === 'SIGNED_IN' && session && state.userId !== session.user.id) {
      state.userId = session.user.id;
      state.userEmail = session.user.email ?? null;
      const target = 'u-' + session.user.id;
      await openScope(target);
      rememberScope(target);
      const local = await LocalDB.open('local');
      const hasLocal = (await local.all('offers')).length + (await local.all('trips')).length + (await local.all('expenses')).length > 0;
      local.close();
      if (hasLocal) toast('Vos données locales sont conservées. Réglages › Compte › « Copier mes données locales dans ce compte » pour les synchroniser.', 'info');
      route();
    }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => undefined);
  route();
  registerSW();
}

function registerSW() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            const b = document.getElementById('banner')!;
            b.innerHTML = '<div class="banner"><span>Mise à jour disponible. Vos données sont conservées.</span> <button class="btn tiny" id="upd">Mettre à jour</button></div>';
            document.getElementById('upd')!.onclick = () => nw.postMessage('skipWaiting');
          }
        });
      });
    })
    .catch(() => undefined);
  // Recharger seulement lors d'une MISE À JOUR acceptée (pas lors de la première installation).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });
}

boot();
