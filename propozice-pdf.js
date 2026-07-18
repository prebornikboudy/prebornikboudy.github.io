/* Export propozic do PDF — čte AKTUÁLNÍ obsah stránky (nadpisy, odstavce,
   tabulku kategorií i program dne), takže po každé úpravě propozic je PDF
   automaticky aktuální. Knihovny (jsPDF + AutoTable + font) se načítají
   až při kliknutí na tlačítko. */
(function () {
  'use strict';

  /* --- načtení skriptu jen jednou --- */
  const _p = {};
  function loadScriptOnce(src) {
    if (_p[src]) return _p[src];
    _p[src] = new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve(true);
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error('Nepodařilo se načíst: ' + src));
      document.head.appendChild(s);
    });
    return _p[src];
  }

  async function ensureJSPDF() {
    const ready = () => !!(window.jspdf?.jsPDF &&
      (typeof window.jspdf.jsPDF.API?.autoTable === 'function' ||
       typeof window.jspdf.jsPDF.prototype?.autoTable === 'function'));
    if (ready()) return true;
    try {
      await loadScriptOnce('data-fontu.js?v=4');
      await loadScriptOnce('export-skript.js?v=4');
      await loadScriptOnce('export-tabulky.js?v=4');
    } catch (e) {
      console.error(e);
      return false;
    }
    return ready();
  }

  /* --- barvy shodné s webem --- */
  const LES = [30, 133, 82];
  const LES_TMAVA = [14, 74, 46];
  const FABOREK = [248, 234, 125];
  const INKOUST = [27, 38, 32];
  const SEDA = [85, 99, 91];

  const cistyText = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  async function exportPropozicePDF() {
    if (!(await ensureJSPDF())) {
      alert('Knihovny pro export do PDF se nepodařilo načíst. Zkuste to prosím znovu.');
      return;
    }

    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

    /* font s českou diakritikou; alias „bold" ukazuje na stejný řez,
       aby AutoTable nepadal na chybějící tučné variantě */
    if (window.NOTO_SANS_BASE64) {
      doc.addFileToVFS('NotoSans-Regular-normal.ttf', window.NOTO_SANS_BASE64);
      doc.addFont('NotoSans-Regular-normal.ttf', 'Noto Sans', 'normal');
      doc.addFont('NotoSans-Regular-normal.ttf', 'Noto Sans', 'bold');
      doc.setFont('Noto Sans', 'normal');
    }

    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 46;                 // okraj
    const SIRKA = W - 2 * M;
    const DOLNI = H - 52;         // hranice pro zalomení stránky
    let y;

    const novaStrana = () => { doc.addPage(); y = M; };
    const misto = (potreba) => { if (y + potreba > DOLNI) novaStrana(); };

    /* ---------- hlavička dokumentu ---------- */
    const h1 = cistyText(document.querySelector('main h1')) || 'Propozice';
    const rokMatch = h1.match(/\d{4}/);
    const rok = rokMatch ? rokMatch[0] : new Date().getFullYear();
    const uvod = document.querySelector('main > p, main .obal > p');

    doc.setFillColor(...LES_TMAVA);
    doc.rect(0, 0, W, 86, 'F');
    // „fáborek" – šikmé žluto-zelené proužky pod hlavičkou
    for (let x = -14; x < W + 14; x += 24) {
      doc.setFillColor(...FABOREK);
      doc.triangle(x, 96, x + 12, 86, x + 24, 96, 'F');
      doc.setFillColor(...LES);
      doc.triangle(x + 12, 86, x + 24, 96, x + 36, 86, 'F');
    }
    doc.setFillColor(...LES);
    doc.rect(0, 86, W, 4, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(23);
    doc.text('O PŘEBORNÍKA BOUDY ' + rok, M, 40);
    doc.setFontSize(13);
    doc.setTextColor(...FABOREK);
    doc.text('PROPOZICE ZÁVODU', M, 62);
    if (uvod) {
      doc.setFontSize(9.5);
      doc.setTextColor(230, 240, 233);
      doc.text(cistyText(uvod), M, 78);
    }
    y = 118;

    /* ---------- vykreslení jedné sekce ---------- */
    const styleTab = {
      font: 'Noto Sans', fontStyle: 'normal', fontSize: 9.5,
      cellPadding: 4, textColor: INKOUST, lineColor: [225, 229, 221], lineWidth: .5,
    };

    function nadpis(text) {
      misto(46);
      doc.setFillColor(...FABOREK);
      doc.rect(M, y - 1, 4, 15, 'F');
      doc.setTextColor(...LES_TMAVA);
      doc.setFontSize(13.5);
      doc.text(text.toUpperCase(), M + 11, y + 11);
      y += 26;
    }

    function odstavec(text) {
      doc.setFontSize(10);
      doc.setTextColor(...INKOUST);
      const radky = doc.splitTextToSize(text, SIRKA);
      for (const r of radky) {
        misto(14);
        doc.text(r, M, y);
        y += 13.5;
      }
      y += 4;
    }

    function odkazy(sekce) {
      const links = [...sekce.querySelectorAll('a[href^="http"]')];
      if (!links.length) return;
      doc.setFontSize(9);
      for (const a of links) {
        misto(12);
        doc.setTextColor(...LES);
        doc.textWithLink('→ ' + cistyText(a) + ':  ' + a.href, M + 6, y, { url: a.href });
        y += 12;
      }
      y += 4;
    }

    function tabulkaZDomu(tableEl) {
      misto(60);
      doc.autoTable({
        html: tableEl,
        startY: y,
        margin: { left: M, right: M },
        styles: styleTab,
        headStyles: { font: 'Noto Sans', fillColor: LES, textColor: [255, 255, 255], fontSize: 9.5 },
        alternateRowStyles: { fillColor: [244, 248, 243] },
      });
      y = doc.lastAutoTable.finalY + 14;
    }

    function programZDomu(ul) {
      const body = [...ul.querySelectorAll('li')].map((li) => {
        const cas = cistyText(li.querySelector('.cas'));
        const co = cistyText(li).replace(cas, '').trim();
        return [cas, co];
      });
      misto(60);
      doc.autoTable({
        body,
        startY: y,
        margin: { left: M, right: M },
        styles: styleTab,
        columnStyles: {
          0: { cellWidth: 58, textColor: LES, halign: 'right', fontSize: 10.5 },
        },
        theme: 'plain',
        alternateRowStyles: { fillColor: [244, 248, 243] },
      });
      y = doc.lastAutoTable.finalY + 14;
    }

    /* ---------- projít všechny sekce tak, jak jsou na stránce ---------- */
    const sekce = document.querySelectorAll('main .propozice-sekce');
    for (const s of sekce) {
      const h = s.querySelector('h2');
      if (h) nadpis(cistyText(h));
      for (const dite of s.children) {
        const tag = dite.tagName;
        if (tag === 'P') {
          odstavec(cistyText(dite));
        } else if (tag === 'TABLE') {
          tabulkaZDomu(dite);
        } else if (tag === 'UL' && dite.classList.contains('program')) {
          programZDomu(dite);
        }
      }
      odkazy(s);
      y += 6;
    }

    /* ---------- patička na každé stránce ---------- */
    const stran = doc.getNumberOfPages();
    const dnes = new Date();
    const datum = `${dnes.getDate()}. ${dnes.getMonth() + 1}. ${dnes.getFullYear()}`;
    for (let i = 1; i <= stran; i++) {
      doc.setPage(i);
      doc.setDrawColor(...LES);
      doc.setLineWidth(.8);
      doc.line(M, H - 34, W - M, H - 34);
      doc.setFontSize(8.5);
      doc.setTextColor(...SEDA);
      doc.text('prebornikboudy.github.io', M, H - 20);
      doc.text(`Vygenerováno ${datum}`, W / 2, H - 20, { align: 'center' });
      doc.text(`Strana ${i} / ${stran}`, W - M, H - 20, { align: 'right' });
    }

    doc.save(`propozice-prebornik-boudy-${rok}.pdf`);
  }

  /* ---------- tlačítko ---------- */
  function init() {
    const btn = document.getElementById('exportPropoziceBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const puvodni = btn.textContent;
      btn.textContent = 'Generuji PDF...';
      btn.disabled = true;
      try { await exportPropozicePDF(); }
      catch (e) { console.error(e); alert('Export do PDF se nezdařil.'); }
      finally { btn.textContent = puvodni; btn.disabled = false; }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
