/* O Přeborníka Boudy — vlastní registrace (bez závislostí)
   Formulář vyskočí po kliknutí na cokoli s atributem data-registrace.
   Přihlášky se na pozadí ukládají do Google tabulky přes Google Apps Script
   a stránka startovka.html si z ní seznam načítá.

   ===== NASTAVENÍ — jediné místo, které se každý rok upravuje ===== */
window.PB_NASTAVENI = {
  // Adresa webové aplikace z Google Apps Script (končí na /exec).
  // Dokud je prázdná, formulář ukáže „registrace se připravuje“.
  URL: 'https://script.google.com/macros/s/AKfycbw91IvYtabWn2I9sbHVj8aUw874WkCdsJ4rKN5NjiIMrC7dpNp1FRWnV6OGixXVCBFi/exec',
  ROK: 2026,
  TERMIN: '18. 10.',
  // Po tomto okamžiku se online registrace zavře (zápis na místě pořád jde).
  UZAVERKA: '2026-10-18T08:00:00+02:00',
};
/* ================================================================ */

(function () {
  'use strict';

  const N = window.PB_NASTAVENI;
  const jeStartovka = /startovka\.html$/i.test(location.pathname);

  /* ---------- komunikace s Googlem ---------- */
  async function nactiSeznam() {
    if (!N.URL) throw new Error('nenastaveno');
    const odp = await fetch(`${N.URL}?rok=${N.ROK}&t=${Date.now()}`, { cache: 'no-store' });
    const data = await odp.json();
    if (!data.ok) throw new Error(data.chyba || 'Chyba při načítání');
    return data.zavodnici || [];
  }

  // Tělo jako prostý text => žádný CORS preflight, Apps Script ho přijme.
  async function odesli(zaznam) {
    const odp = await fetch(N.URL, { method: 'POST', body: JSON.stringify(zaznam) });
    return odp.json();
  }

  const klic = (z) => [z.jmeno, z.prijmeni, z.rocnik]
    .map((x) => String(x).trim().toLocaleLowerCase('cs')).join('|');

  /* ---------- vzhled okna (vlastní, nezávislý na site.css) ---------- */
  const STYL = `
  .reg-okno{width:min(540px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:0;border:0;
    border-radius:16px;box-shadow:0 24px 60px rgba(10,46,28,.35);background:#fff;color:#22312A;overflow:auto;
    font-family:inherit;}
  .reg-okno::backdrop{background:rgba(10,46,28,.62);backdrop-filter:blur(2px);}
  .reg-okno[open]{animation:reg-vyjet .18s ease-out;}
  @keyframes reg-vyjet{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  .reg-hlava{display:flex;align-items:center;justify-content:space-between;gap:12px;
    background:#0F4D2A;color:#fff;padding:16px 20px;}
  .reg-hlava h2{margin:0;font-size:1.6rem;line-height:1.1;letter-spacing:.01em;color:#fff;}
  .reg-okno .faborek{height:8px;background:repeating-linear-gradient(135deg,#F5D547 0 14px,#0F4D2A 14px 28px);}
  .reg-zavrit{background:none;border:0;color:#fff;font-size:1.25rem;line-height:1;cursor:pointer;
    padding:6px 10px;border-radius:8px;}
  .reg-zavrit:hover{background:rgba(255,255,255,.16);}
  .reg-telo{padding:20px 22px 22px;}
  .reg-uvod{margin:0 0 18px;color:#5A6B60;font-size:.95rem;}
  .reg-radek{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;}
  @media (max-width:520px){.reg-radek{grid-template-columns:1fr;gap:12px;}}
  .reg-form label{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:.95rem;}
  .reg-form label small{font-weight:400;color:#7A8A80;}
  .reg-form input{font:inherit;font-weight:400;padding:11px 13px;border:1.5px solid #D3DBCF;border-radius:10px;
    background:#FBFCFA;color:#22312A;width:100%;transition:border-color .12s,box-shadow .12s;}
  .reg-form input:hover{border-color:#B7C4B1;}
  .reg-form input:focus{outline:none;border-color:#2E7D4F;box-shadow:0 0 0 3px rgba(46,125,79,.18);background:#fff;}
  .reg-form input:disabled{background:#F1F3EF;color:#8A968E;}
  .reg-form input::placeholder{color:#A9B4AC;}
  .reg-stav{min-height:1.3em;margin:14px 0 4px;font-size:.95rem;}
  .reg-stav.chyba{color:#A3261B;font-weight:600;}
  .reg-tlacitka{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;}
  .reg-okno .tl{font-family:inherit;}
  .reg-okno .tl-sede{background:#EEF1EC;color:#22312A;}
  .reg-okno .tl-sede:hover{background:#E1E7DF;color:#0F4D2A;}
  .reg-poznamka{margin:16px 0 0;font-size:.82rem;line-height:1.45;color:#7A8A80;}
  .reg-hotovo-text{font-size:1.1rem;line-height:1.45;margin:0 0 18px;}
  .reg-hotovo-text::before{content:"✔ ";color:#2E7D4F;font-weight:700;}
  `;

  function vlozStyl() {
    if (document.getElementById('reg-styl')) return;
    const st = document.createElement('style');
    st.id = 'reg-styl';
    st.textContent = STYL;
    document.head.appendChild(st);
  }

  /* ---------- vyskakovací okno ---------- */
  let dlg, form, stav, tlOdeslat, oddilyList;

  function vytvorOkno() {
    vlozStyl();
    dlg = document.createElement('dialog');
    dlg.className = 'reg-okno';
    dlg.setAttribute('aria-labelledby', 'regNadpis');
    dlg.innerHTML = `
      <div class="reg-hlava">
        <h2 id="regNadpis">Registrace ${N.ROK}</h2>
        <button type="button" class="reg-zavrit" aria-label="Zavřít">✕</button>
      </div>
      <div class="faborek"></div>
      <div class="reg-telo">
        <p class="reg-uvod">Registrace je zdarma, stačí čtyři údaje. Hned se objevíte ve startovní listině.</p>
        <form class="reg-form" novalidate>
          <div class="reg-radek">
            <label><span>Jméno</span><input name="jmeno" autocomplete="given-name" maxlength="40" required></label>
            <label><span>Příjmení</span><input name="prijmeni" autocomplete="family-name" maxlength="40" required></label>
          </div>
          <div class="reg-radek">
            <label><span>Ročník narození</span><input name="rocnik" type="number" inputmode="numeric"
                   min="1920" max="${N.ROK}" placeholder="např. 1990" required></label>
            <label><span>Oddíl <small>(nepovinné)</small></span><input name="oddil" list="regOddily" maxlength="60"
                   placeholder="klub, obec, parta…"></label>
          </div>
          <datalist id="regOddily"></datalist>
          <div class="reg-past" aria-hidden="true" style="position:absolute!important;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden">
            <label>Web<input name="web" tabindex="-1" autocomplete="off"></label>
          </div>
          <p class="reg-stav" role="status" aria-live="polite"></p>
          <div class="reg-tlacitka">
            <button type="submit" class="tl tl-zeleny">Registrovat</button>
            <button type="button" class="tl tl-sede reg-zrusit">Zrušit</button>
          </div>
          <p class="reg-poznamka">Odesláním souhlasíte se zveřejněním jména, ročníku a oddílu
             ve startovní listině a ve výsledcích. Za nezletilé registruje zákonný zástupce.</p>
        </form>
        <div class="reg-hotovo" hidden>
          <p class="reg-hotovo-text"></p>
          <div class="reg-tlacitka">
            ${jeStartovka ? '' : '<a class="tl tl-zeleny" href="startovka.html">Startovní listina</a>'}
            <button type="button" class="tl tl-sede reg-dalsi">Registrovat dalšího</button>
            <button type="button" class="tl tl-sede reg-zavrit2">Zavřít</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(dlg);

    form = dlg.querySelector('.reg-form');
    stav = dlg.querySelector('.reg-stav');
    tlOdeslat = form.querySelector('[type=submit]');
    oddilyList = dlg.querySelector('#regOddily');

    const zavri = () => dlg.close();
    dlg.querySelector('.reg-zavrit').addEventListener('click', zavri);
    dlg.querySelector('.reg-zrusit').addEventListener('click', zavri);
    dlg.querySelector('.reg-zavrit2').addEventListener('click', zavri);
    dlg.querySelector('.reg-dalsi').addEventListener('click', () => ukazFormular(true));
    // klik na ztmavené pozadí zavře okno
    dlg.addEventListener('click', (e) => { if (e.target === dlg) zavri(); });
    form.addEventListener('submit', onOdeslat);
    form.addEventListener('input', () => { if (stav.classList.contains('chyba')) nastavStav(''); });
  }

  function nastavStav(text, typ) {
    stav.textContent = text || '';
    stav.className = 'reg-stav' + (typ ? ' ' + typ : '');
  }

  function ukazFormular(vycistit) {
    dlg.querySelector('.reg-hotovo').hidden = true;
    form.hidden = false;
    if (vycistit) {
      const oddil = form.oddil.value;
      form.reset();
      form.oddil.value = oddil;      // další člen oddílu to má jednodušší
    }
    nastavStav('');
    zamkni(false);
    form.jmeno.focus();
  }

  function zamkni(ano) {
    [...form.elements].forEach((el) => { el.disabled = ano; });
  }

  async function doplnOddily() {
    try {
      const seznam = await nactiSeznam();
      const oddily = [...new Set(seznam.map((z) => z.oddil).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'cs'));
      oddilyList.innerHTML = '';
      oddily.forEach((o) => { const op = document.createElement('option'); op.value = o; oddilyList.appendChild(op); });
    } catch (_) { /* nevadí, jen nebude našeptávač */ }
  }

  function otevri() {
    if (!dlg) vytvorOkno();
    ukazFormular(false);

    if (!N.URL) {
      nastavStav('Online registrace se právě připravuje. Zkuste to prosím později.', 'chyba');
      zamkni(true);
      form.querySelector('.reg-zrusit').disabled = false;
    } else if (N.UZAVERKA && Date.now() > new Date(N.UZAVERKA).getTime()) {
      nastavStav('Online registrace je uzavřena. Zapsat se můžete ještě na místě před startem.', 'chyba');
      zamkni(true);
      form.querySelector('.reg-zrusit').disabled = false;
    } else {
      doplnOddily();
    }

    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  async function onOdeslat(e) {
    e.preventDefault();
    const f = form;
    const zaznam = {
      rok: N.ROK,
      jmeno: f.jmeno.value.trim(),
      prijmeni: f.prijmeni.value.trim(),
      rocnik: f.rocnik.value.trim(),
      oddil: f.oddil.value.trim(),
      web: f.web.value,
    };

    const r = Number(zaznam.rocnik);
    if (!zaznam.jmeno) { nastavStav('Vyplňte jméno.', 'chyba'); return f.jmeno.focus(); }
    if (!zaznam.prijmeni) { nastavStav('Vyplňte příjmení.', 'chyba'); return f.prijmeni.focus(); }
    if (!/^\d{4}$/.test(zaznam.rocnik) || r < 1920 || r > N.ROK) {
      nastavStav('Ročník narození zadejte jako čtyřmístný rok, např. 1990.', 'chyba');
      return f.rocnik.focus();
    }

    zamkni(true);
    nastavStav('Odesílám…');

    let vysledek;
    try {
      vysledek = await odesli(zaznam);
    } catch (err) {
      // odpověď se nemusela doručit, i když zápis proběhl — ověřit v seznamu
      try {
        const seznam = await nactiSeznam();
        vysledek = seznam.some((z) => klic(z) === klic(zaznam))
          ? { ok: true }
          : { ok: false, chyba: 'Registraci se nepodařilo odeslat. Zkontrolujte připojení a zkuste to znovu.' };
      } catch (_) {
        vysledek = { ok: false, chyba: 'Registraci se nepodařilo odeslat. Zkontrolujte připojení a zkuste to znovu.' };
      }
    }

    if (vysledek && vysledek.ok) {
      form.hidden = true;
      const hotovo = dlg.querySelector('.reg-hotovo');
      hotovo.querySelector('.reg-hotovo-text').textContent =
        `Hotovo! ${zaznam.jmeno} ${zaznam.prijmeni} je ve startovní listině. Uvidíme se ${N.TERMIN} na startu.`;
      hotovo.hidden = false;
      hotovo.querySelector('.reg-dalsi').focus();
      document.dispatchEvent(new CustomEvent('pb:registrovano', { detail: zaznam }));
    } else {
      zamkni(false);
      nastavStav((vysledek && vysledek.chyba) || 'Registrace se nezdařila.', 'chyba');
    }
  }

  /* ---------- napojení odkazů ---------- */
  document.addEventListener('click', (e) => {
    const spoust = e.target.closest('[data-registrace]');
    if (!spoust) return;
    e.preventDefault();
    otevri();
  });

  function init() {
    if (jeStartovka && location.hash === '#registrace') otevri();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.PB_REGISTRACE = { otevri, nactiSeznam };
})();
