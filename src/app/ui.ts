// Petits utilitaires d'interface : échappement, formatage, notifications internes.
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;

export function num(x: number | null | undefined, d = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const eur = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : num(x, d) + ' €');

export function dt(iso: string | null | undefined, withSec = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', ...(withSec ? { second: '2-digit' } : {}) });
}

export function dur(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/** Saisie décimale française : "12,5" -> 12.5 ; vide -> null ; invalide -> NaN. */
export function parseInput(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export const inputVal = (x: number | null | undefined) => (x === null || x === undefined ? '' : String(x).replace('.', ','));

let toastTimer: number | undefined;
export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.className = 'toast ' + kind;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el!.hidden = true), 4000);
}

export function download(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli : zone de texte sélectionnée
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function readFile(input: HTMLInputElement): Promise<string | null> {
  const f = input.files?.[0];
  if (!f) return Promise.resolve(null);
  return f.text();
}

export function readFileBase64(input: HTMLInputElement): Promise<{ b64: string; mime: string } | null> {
  const f = input.files?.[0];
  if (!f) return Promise.resolve(null);
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      res({ b64: s.slice(s.indexOf(',') + 1), mime: f.type });
    };
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

export const VERDICT_CLASS: Record<string, string> = {
  favorable: 'v-fav',
  limite: 'v-lim',
  faible: 'v-low',
  partiel: 'v-part',
  indisponible: 'v-na',
};
