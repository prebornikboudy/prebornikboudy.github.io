/* =========================================================================
   Stahovací Service Worker – O Přeborníka Boudy

   Proč existuje: některé prohlížeče (např. Seznam Prohlížeč na Androidu)
   ignorují u odkazu atribut download, pokud odkaz míří na blob: adresu.
   Název souboru si pak vezmou z adresy – a tou je náhodné UUID, takže
   uživateli spadne do stahování něco jako
   "941388f3-0139-4604-82ba-64e79ffd13b9.pdf".

   Řešení: stránka pošle hotový soubor sem, worker si ho podrží v paměti
   a vydá ho na normální https adrese, jejíž poslední částí je požadovaný
   název – např. /stahni/Vysledky_Prebornik_Boudy.pdf. Prohlížeč tak
   dostane jméno rovnou v cestě a navíc hlavičku Content-Disposition.

   Worker nic necachuje a nijak nezasahuje do běžného načítání stránek.
   ========================================================================= */
'use strict';

const PREDPONA = 'stahni';
const soubory = new Map();          // klíč -> { data, typ, cas }
const PLATNOST = 5 * 60 * 1000;     // nevyzvednuté položky zahodit po 5 min

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Úklid starých položek, aby paměť nerostla, kdyby stažení neproběhlo.
function uklid() {
  const ted = Date.now();
  for (const [klic, zaznam] of soubory) {
    if (ted - zaznam.cas > PLATNOST) soubory.delete(klic);
  }
}

// Stránka sem pošle hotová data souboru.
self.addEventListener('message', (e) => {
  const zprava = e.data;
  if (!zprava || zprava.typZpravy !== 'pripravSoubor') return;
  uklid();
  soubory.set(zprava.klic, {
    data: zprava.data,
    typ: zprava.mime || 'application/octet-stream',
    cas: Date.now(),
  });
  // potvrzení zpět stránce, aby věděla, že může spustit stahování
  if (e.ports && e.ports[0]) e.ports[0].postMessage({ pripraveno: true });
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  const casti = url.pathname.split('/').filter(Boolean);
  if (casti[casti.length - 2] !== PREDPONA) return;   // /stahni/<nazev>

  const klic = url.searchParams.get('klic');
  const zaznam = klic && soubory.get(klic);
  if (!zaznam) return;               // necháme projít na běžné zpracování (404)

  soubory.delete(klic);              // jednorázové použití

  const nazev = decodeURIComponent(casti[casti.length - 1]);
  e.respondWith(new Response(zaznam.data, {
    headers: {
      'Content-Type': zaznam.typ,
      'Content-Disposition':
        `attachment; filename="${nazev}"; filename*=UTF-8''${encodeURIComponent(nazev)}`,
      'Content-Length': String(zaznam.data.byteLength || zaznam.data.size || ''),
      'Cache-Control': 'no-store',
    },
  }));
});
