/* =========================================================================
   Výsledky závodu – Přeborník Boudy
   Refaktorovaná verze: jeden soubor, jedno načtení dat, sdílené pomocné
   funkce, exportní knihovny (SheetJS, jsPDF) se načítají až při kliknutí
   na export – stránka tak nestahuje ~2 MB JS zbytečně.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     0) Pomocné funkce (sdílené v celém souboru)
     --------------------------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);

  function normalize(s) {
    return (s || '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }

  const clean = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();

  function parseTimeToSeconds(t) {
    t = (t || '').trim();
    if (!t) return Number.MAX_SAFE_INTEGER;
    const parts = t.split(':').map((p) => Number(p.replace(',', '.')));
    if (parts.some(Number.isNaN)) return Number.MAX_SAFE_INTEGER;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return Number.MAX_SAFE_INTEGER;
  }

  function tratToMeters(s) {
    const x = (s || '').toString().trim().toLowerCase().replace(',', '.');
    if (x.endsWith('km')) { const n = parseFloat(x); return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : Math.round(n * 1000); }
    if (x.endsWith('m'))  { const n = parseFloat(x); return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : Math.round(n); }
    return Number.MAX_SAFE_INTEGER;
  }

  const isAll = (v) => v === '' || v === 'Vše';

  // Držet sufix "-kluci"/"-holky" při automatickém přepnutí kategorie
  const sexSuffix = (kat) => (/-\s*kluci$/i.test(kat) ? 'kluci' : /-\s*holky$/i.test(kat) ? 'holky' : '');

  function isInAppBrowser() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    return /FBAN|FBAV|FB_IAB|Instagram|Messenger/i.test(ua);
  }

  // Načtení externího skriptu jen jednou (pro lazy-load exportních knihoven)
  const _scriptPromises = {};
  function loadScriptOnce(src) {
    if (_scriptPromises[src]) return _scriptPromises[src];
    _scriptPromises[src] = new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve(true);
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error('Nepodařilo se načíst: ' + src));
      document.head.appendChild(s);
    });
    return _scriptPromises[src];
  }

  /* ---------------------------------------------------------------------
     1) Oprava escapovaných znaků v datech (\+ → +, \- → -)
     --------------------------------------------------------------------- */
  document.querySelectorAll('#resultsTable td, #resultsTable th').forEach((td) => {
    if (td.textContent.includes('\\')) {
      td.textContent = td.textContent.replaceAll('\\+', '+').replaceAll('\\-', '-');
    }
  });

  /* ---------------------------------------------------------------------
     2) Načtení dat z tabulky – JEDNOU, pro všechny části skriptu
     --------------------------------------------------------------------- */
  const tableEl = $('#resultsTable') || document.querySelector('table');
  if (!tableEl) return;
  const thead = tableEl.tHead || tableEl.createTHead();
  const tbody = tableEl.tBodies[0] || tableEl.appendChild(document.createElement('tbody'));

  const headerRow = (thead.rows && thead.rows[0]) || tableEl.querySelector('tr');
  const hdrs = Array.from(headerRow.cells).map((th) => th.textContent.trim().toLowerCase());
  const colIdx = {
    poradi:    hdrs.findIndex((h) => h.startsWith('pořadí')),
    jmeno:     hdrs.findIndex((h) => h.startsWith('jméno')),
    tym:       hdrs.findIndex((h) => h.startsWith('tým')),
    trat:      hdrs.findIndex((h) => h.startsWith('trať')),
    kategorie: hdrs.findIndex((h) => h.startsWith('kategorie')),
    cas:       hdrs.findIndex((h) => h.startsWith('čas')),
    rok:       hdrs.findIndex((h) => h.startsWith('rok')),
  };

  const originalRows = Array.from(tbody.rows);
  const DATA = originalRows.map((tr) => {
    const cells = Array.from(tr.cells).map((td) => (td.textContent || '').trim());
    const tratRaw = clean(cells[colIdx.trat] || '');
    const casRaw  = clean(cells[colIdx.cas]  || '');
    return {
      el:        tr,
      jmeno:     clean(cells[colIdx.jmeno]     || ''),
      tym:       clean(cells[colIdx.tym]       || ''),
      trat:      tratRaw,
      kategorie: clean(cells[colIdx.kategorie] || ''),
      cas:       casRaw,
      rok:       clean(cells[colIdx.rok]       || ''),
      jmenoNorm: normalize(clean(cells[colIdx.jmeno] || '')),
      casSec:    parseTimeToSeconds(casRaw),
      tratM:     tratToMeters(tratRaw),
    };
  });

  /* ---------------------------------------------------------------------
     3) Indexy dostupnosti (trať ↔ kategorie ↔ rok)
     --------------------------------------------------------------------- */
  const byTrack    = new Map(); // trať -> { cats:Set, years:Set }
  const byTrackCat = new Map(); // "trať|kategorie" -> Set(roků)
  const byCat      = new Map(); // kategorie -> { tracks:Set, years:Set }

  for (const r of DATA) {
    if (!byTrack.has(r.trat)) byTrack.set(r.trat, { cats: new Set(), years: new Set() });
    byTrack.get(r.trat).cats.add(r.kategorie);
    byTrack.get(r.trat).years.add(r.rok);

    const tk = `${r.trat}|${r.kategorie}`;
    if (!byTrackCat.has(tk)) byTrackCat.set(tk, new Set());
    byTrackCat.get(tk).add(r.rok);

    if (!byCat.has(r.kategorie)) byCat.set(r.kategorie, { tracks: new Set(), years: new Set() });
    byCat.get(r.kategorie).tracks.add(r.trat);
    byCat.get(r.kategorie).years.add(r.rok);
  }

  const uniqCs = (arr) => Array.from(new Set(arr)).filter((v) => v !== '').sort((a, b) => a.localeCompare(b, 'cs'));
  const allTracks = Array.from(new Set(DATA.map((d) => d.trat))).filter(Boolean)
    .sort((a, b) => tratToMeters(b) - tratToMeters(a)); // od nejdelší po nejkratší
  const allYears = Array.from(new Set(DATA.map((d) => d.rok))).filter(Boolean)
    .sort((a, b) => b.localeCompare(a, 'cs', { numeric: true })); // nejnovější první

  /* ---------------------------------------------------------------------
     4) Ovládací prvky
     --------------------------------------------------------------------- */
  const kategorieSel = $('#category');
  const tratSel      = $('#track');
  const rokSel       = $('#year');
  const searchInput  = $('#searchName');

  /* ---------------------------------------------------------------------
     5) Hlavní render (filtrování + řazení + pořadí)
     --------------------------------------------------------------------- */
  function render() {
    const kat   = kategorieSel?.value ?? '';
    const trat  = tratSel?.value ?? '';
    const rok   = rokSel?.value ?? '';
    const query = normalize(searchInput?.value ?? '');

    const rows = DATA.filter((r) =>
      (isAll(kat)  || r.kategorie === kat) &&
      (isAll(trat) || r.trat === trat) &&
      (isAll(rok)  || r.rok === rok) &&
      (!query || r.jmenoNorm.includes(query))
    );

    // Režimy zobrazení:
    //  - vše/vše, nebo konkrétní kategorie napříč tratěmi i roky -> seskupit po tratích
    const vseVse = isAll(kat) && isAll(trat);
    const groupByTrack = !isAll(kat) && isAll(trat) && isAll(rok);
    const grouped = vseVse || groupByTrack;

    rows.sort(grouped
      ? (a, b) => (a.tratM - b.tratM) || (a.casSec - b.casSec) || a.jmenoNorm.localeCompare(b.jmenoNorm, 'cs')
      : (a, b) => (a.casSec - b.casSec) || (a.tratM - b.tratM) || a.jmenoNorm.localeCompare(b.jmenoNorm, 'cs')
    );

    const frag = document.createDocumentFragment();
    if (grouped) {
      let currentTrat = null, rank = 0;
      for (const r of rows) {
        if (r.trat !== currentTrat) { currentTrat = r.trat; rank = 1; }
        r.el.style.display = '';
        if (colIdx.poradi >= 0) r.el.cells[colIdx.poradi].textContent = rank++;
        frag.appendChild(r.el);
      }
    } else {
      rows.forEach((r, i) => {
        r.el.style.display = '';
        if (colIdx.poradi >= 0) r.el.cells[colIdx.poradi].textContent = i + 1;
        frag.appendChild(r.el);
      });
    }

    const visibleSet = new Set(rows.map((r) => r.el));
    for (const tr of originalRows) {
      if (!visibleSet.has(tr)) tr.style.display = 'none';
    }
    tbody.appendChild(frag);
  }
  window.render = render;
  window.applyFilters = render; // alias pro starší kód / URL auto-export

  /* ---------------------------------------------------------------------
     6) Dynamické domény filtrů + automatické sladění hodnot
     --------------------------------------------------------------------- */
  function fillOptions(sel, values, allLabel) {
    const keep = sel.value;
    sel.innerHTML = '';
    const oAll = document.createElement('option');
    oAll.value = '';
    oAll.textContent = allLabel;
    sel.appendChild(oAll);
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    }
    sel.value = (keep && values.includes(keep)) ? keep : '';
  }

  // Doména "Trať" se řídí rokem; doména "Kategorie" průnikem Rok × Trať
  function rebuildFilterOptions() {
    if (!tratSel || !kategorieSel) return;
    const y = rokSel?.value || '';

    const tracks = y
      ? allTracks.filter((t) => byTrack.get(t)?.years.has(y))
      : allTracks;
    fillOptions(tratSel, tracks, '— Vše —');

    const t = tratSel.value || '';
    let filtered = DATA;
    if (y) filtered = filtered.filter((d) => d.rok === y);
    if (t) filtered = filtered.filter((d) => d.trat === t);
    fillOptions(kategorieSel, uniqCs(filtered.map((d) => d.kategorie)), '— Vše —');
  }

  // Při změně KATEGORIE udrž trať/rok kompatibilní
  function onCategoryChange() {
    const category = kategorieSel?.value || '';
    if (category === '') { rebuildFilterOptions(); render(); return; }

    // TRAŤ
    let track = tratSel?.value || '';
    const possibleTracks = byCat.get(category)?.tracks || new Set();
    if (!possibleTracks.has(track)) {
      track = possibleTracks.size === 1 ? [...possibleTracks][0] : '';
    }

    // ROK
    const yearsSet = track === ''
      ? (byCat.get(category)?.years || new Set())
      : (byTrackCat.get(`${track}|${category}`) || new Set());
    let year = rokSel?.value || '';
    if (yearsSet.size === 1) year = [...yearsSet][0];
    else if (year && !yearsSet.has(year)) year = '';

    if (rokSel) rokSel.value = year;
    rebuildFilterOptions();
    if (tratSel) tratSel.value = track;
    if (kategorieSel) kategorieSel.value = category;
    render();
  }

  // Při změně TRATĚ udrž kategorii/rok kompatibilní
  function onTrackChange() {
    const track = tratSel?.value || '';
    if (track === '') { rebuildFilterOptions(); render(); return; }

    const entry = byTrack.get(track);
    if (!entry) { rebuildFilterOptions(); render(); return; }

    // KATEGORIE (drží se stejné pohlaví -kluci/-holky, když to jde)
    let category = kategorieSel?.value || '';
    if (!entry.cats.has(category)) {
      if (entry.cats.size === 1) {
        category = [...entry.cats][0];
      } else {
        const want = sexSuffix(category);
        const sameSex = want ? [...entry.cats].find((c) => sexSuffix(c) === want) : null;
        category = sameSex || '';
      }
    }

    // ROK
    const yearsSet = category === ''
      ? entry.years
      : (byTrackCat.get(`${track}|${category}`) || entry.years);
    let year = rokSel?.value || '';
    if (yearsSet.size === 1) year = [...yearsSet][0];
    else if (year && !yearsSet.has(year)) year = '';

    if (rokSel) rokSel.value = year;
    rebuildFilterOptions();
    if (tratSel) tratSel.value = track;
    if (kategorieSel) kategorieSel.value = category;
    render();
  }

  function onYearChange() {
    rebuildFilterOptions();
    render();
  }

  /* ---------------------------------------------------------------------
     7) Inicializace filtrů a událostí
     --------------------------------------------------------------------- */
  function initFilters() {
    // Naplnit rok z dat (nejnovější první)
    if (rokSel) fillOptions(rokSel, allYears, 'Vše');

    // Výchozí hodnoty při prvním načtení
    const setIfExists = (sel, val) => {
      if (!sel) return;
      if (Array.from(sel.options).some((o) => o.value === val)) sel.value = val;
    };
    setIfExists(rokSel, '2025');
    rebuildFilterOptions();
    setIfExists(tratSel, '3,9 km');
    rebuildFilterOptions(); // kategorie podle právě nastavené tratě

    kategorieSel?.addEventListener('change', onCategoryChange);
    tratSel?.addEventListener('change', onTrackChange);
    rokSel?.addEventListener('change', onYearChange);
    searchInput?.addEventListener('input', render);

    render();
  }

  /* ---------------------------------------------------------------------
     9) Přepínač sloupců na mobilu
     --------------------------------------------------------------------- */
  function initToggleCols(onScrollRefresh) {
    const btn = $('#toggleCols');
    if (!btn) return;
    const updateLabel = () => {
      btn.textContent = document.body.classList.contains('show-all-cols') ? 'Skrýt sloupce' : 'Zobrazit všechny sloupce';
    };
    btn.addEventListener('click', () => {
      document.body.classList.toggle('show-all-cols');
      updateLabel();
      if (onScrollRefresh) setTimeout(onScrollRefresh, 0);
    });
    updateLabel();
  }

  /* ---------------------------------------------------------------------
     10) Export – společné funkce
     --------------------------------------------------------------------- */
  function getVisibleTableData() {
    const rows = [];
    const headRow = tableEl.tHead?.querySelector('tr');
    if (headRow) rows.push(Array.from(headRow.cells).map((c) => c.innerText.trim()));
    for (const tr of tbody.rows) {
      if (tr.hidden || tr.style.display === 'none') continue;
      const row = Array.from(tr.cells).map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim());
      if (row.length) rows.push(row);
    }
    return rows;
  }

  function withButtonBusy(btn, busyText, fn) {
    return async () => {
      const original = btn.textContent;
      btn.textContent = busyText;
      btn.disabled = true;
      try { await fn(); }
      finally { btn.textContent = original; btn.disabled = false; }
    };
  }

  /* ---------------------------------------------------------------------
     11) Export do Excelu (SheetJS se načítá až při kliknutí)
     --------------------------------------------------------------------- */
  async function ensureXLSX() {
    if (window.XLSX?.utils && window.XLSX.writeFile) return true;
    try { await loadScriptOnce('xlsx.full.min.js?v=4'); } catch (e) { console.error(e); }
    return !!(window.XLSX?.utils && window.XLSX.writeFile);
  }

  function aoaToCSV(aoa) {
    const esc = (v) => {
      const s = (v ?? '').toString().replace(/"/g, '""');
      return /[",;\n]/.test(s) ? `"${s}"` : s;
    };
    return '\uFEFF' + aoa.map((r) => r.map(esc).join(';')).join('\n'); // BOM + ; kvůli českému Excelu
  }

  async function exportXLSX(baseName = 'Vysledky_Prebornik_Boudy') {
    const data = getVisibleTableData();
    if (data.length <= 1) { alert('Není co exportovat.'); return; }

    if (await ensureXLSX()) {
      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Vysledky');

      // 1) přímé stažení
      try {
        XLSX.writeFile(wb, `${baseName}.xlsx`, { compression: true });
        return;
      } catch (e) {
        console.warn('[export] writeFile selhal, zkouším sdílení/blob', e);
      }

      // 2) sdílení (mobily) nebo blob download
      try {
        const ab = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
        const xBlob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const xFile = new File([xBlob], `${baseName}.xlsx`, { type: xBlob.type });
        if (navigator.canShare && navigator.canShare({ files: [xFile] })) {
          await navigator.share({ files: [xFile], title: baseName });
        } else {
          const url = URL.createObjectURL(xBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${baseName}.xlsx`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 15000);
        }
        return;
      } catch (e) {
        console.warn('[export] blob export selhal, padám na CSV', e);
      }
    }

    // 3) CSV fallback (hlavně in-app prohlížeče)
    const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(aoaToCSV(data));
    if (isInAppBrowser()) {
      window.location.href = dataUri;
      setTimeout(() => {
        alert('Pro spolehlivé stažení XLSX otevři stránku v Safari/Chrome přes „Otevřít v prohlížeči“ a export zopakuj.');
      }, 600);
      return;
    }
    const a = document.createElement('a');
    a.href = dataUri;
    a.download = `${baseName}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------------------------------------------------------------------
     12) Export do PDF (jsPDF + AutoTable + font se načítají při kliknutí)
     --------------------------------------------------------------------- */
  async function ensureJSPDF() {
    const ready = () => !!(window.jspdf?.jsPDF &&
      (typeof window.jspdf.jsPDF.API?.autoTable === 'function' ||
       typeof window.jspdf.jsPDF.prototype?.autoTable === 'function'));
    if (ready()) return true;
    try {
      await loadScriptOnce('data-fontu.js?v=4');       // NOTO_SANS_BASE64
      await loadScriptOnce('export-skript.js?v=4');    // jsPDF
      await loadScriptOnce('export-tabulky.js?v=4');   // AutoTable plugin
    } catch (e) {
      console.error('Nepodařilo se načíst knihovny pro PDF.', e);
      return false;
    }
    return ready();
  }

  async function exportPDF(baseName = 'Vysledky_Prebornik_Boudy') {
    const data = getVisibleTableData();
    if (data.length <= 1) { alert('Není co exportovat.'); return; }

    if (isInAppBrowser()) {
      alert('Pro export do PDF prosím otevřete stránku ve svém běžném prohlížeči (např. Chrome nebo Safari).');
      return;
    }
    if (!(await ensureJSPDF())) {
      alert('Chyba: Knihovny pro export do PDF se nepodařilo načíst.');
      return;
    }

    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

    if (window.NOTO_SANS_BASE64) {
      doc.addFileToVFS('NotoSans-Regular-normal.ttf', window.NOTO_SANS_BASE64);
      doc.addFont('NotoSans-Regular-normal.ttf', 'Noto Sans', 'normal');
      doc.addFont('NotoSans-Regular-normal.ttf', 'Noto Sans', 'bold');
      doc.setFont('Noto Sans', 'normal');
    } else {
      console.warn('Font data (NOTO_SANS_BASE64) nebyla nalezena!');
    }

    // Nadpis dokumentu
    const W = doc.internal.pageSize.getWidth();
    doc.setFontSize(17);
    doc.setTextColor(14, 74, 46);
    doc.text('Výsledky závodu O Přeborníka Boudy', W / 2, 52, { align: 'center' });
    doc.setDrawColor(30, 133, 82);
    doc.setLineWidth(1.2);
    doc.line(W / 2 - 110, 62, W / 2 + 110, 62);

    doc.autoTable({
      head: [data[0]],
      body: data.slice(1),
      startY: 78,
      styles:  { font: 'Noto Sans', fontStyle: 'normal', fontSize: 8.5, cellPadding: 3 },
      headStyles: { font: 'Noto Sans', fillColor: [30, 133, 82], textColor: [255, 255, 255], fontSize: 8.5 },
      alternateRowStyles: { fillColor: [244, 248, 243] },
      tableWidth: 'auto',
      margin: { left: 42, right: 42, top: 42, bottom: 42 },
    });

    doc.save(`${baseName}.pdf`);
  }

  /* ---------------------------------------------------------------------
     13) In-app prohlížeče (FB/Messenger/Instagram):
         export přesměruje ven z WebView a spustí se automaticky přes URL
     --------------------------------------------------------------------- */
  function initInAppPatch() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    const isAndroid = /Android/i.test(ua);
    const isiOS = /iPhone|iPad|iPod/i.test(ua);
    const isInApp = isInAppBrowser();

    function getState() {
      return {
        cat: kategorieSel?.value || '',
        trk: tratSel?.value || '',
        yr:  rokSel?.value  || '',
        q:   searchInput?.value || '',
      };
    }
    function setIfExists(el, val) {
      if (!el || val === null || val === undefined) return false;
      if (el.tagName === 'SELECT') {
        const opt = Array.from(el.options).find((o) => o.value === val)
                 || Array.from(el.options).find((o) => (o.text || '').trim() === val);
        if (!opt) return false;
        el.value = opt.value;
      } else {
        el.value = val;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      return true;
    }
    async function applyFiltersFromQuery() {
      const p = new URLSearchParams(location.search);
      setIfExists(rokSel, p.get('yr'));       // rok první – řídí domény ostatních
      setIfExists(tratSel, p.get('trk'));
      setIfExists(kategorieSel, p.get('cat'));
      setIfExists(searchInput, p.get('q'));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    // A) V in-app prohlížeči: klik na export → přenést filtry do URL a poslat uživatele ven
    if (isInApp) {
      document.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.export-btn');
        if (!btn) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();

        const exportType = btn.dataset.exportType;
        if (!exportType) return;

        const url = new URL(location.href);
        url.searchParams.set('autoexport', exportType);
        url.searchParams.delete('autoxls');
        const st = getState();
        // přenést VŠECHNY filtry, i prázdné – prázdná hodnota znamená "Vše"
        // (jinak by se venku místo "Vše" použilo výchozí nastavení stránky)
        url.searchParams.set('cat', st.cat);
        url.searchParams.set('trk', st.trk);
        url.searchParams.set('yr',  st.yr);
        if (st.q) url.searchParams.set('q', st.q);

        if (isAndroid) {
          const intent = 'intent://' + url.href.replace(/^https?:\/\//, '') +
            '#Intent;scheme=' + location.protocol.replace(':', '') +
            ';package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(url.href) + ';end';
          window.location.href = intent;
          setTimeout(() => {
            try { if (!document.hidden) alert('Pro export otevřete stránku v prohlížeči mimo Facebook/Messenger.'); } catch (e) {}
          }, 1500);
        } else if (isiOS) {
          const a = document.createElement('a');
          a.href = url.href; a.target = '_blank'; a.rel = 'noopener'; a.style.display = 'none';
          document.body.appendChild(a); a.click();
          setTimeout(() => a.remove(), 50);
        } else {
          location.href = url.href;
        }
      }, true);
    }

    // B) Venku: ?autoexport=... → aplikovat filtry a spustit export
    return async function runAutoExportIfRequested() {
      const p = new URLSearchParams(location.search);
      const exportType = p.get('autoexport') || (p.get('autoxls') === '1' ? 'xlsx' : null);
      if (!exportType || window.__autoExportDone) return;
      window.__autoExportDone = true;

      await applyFiltersFromQuery();
      const btnToClick = exportType === 'xlsx' ? $('#exportBtn') : exportType === 'pdf' ? $('#exportPdfBtn') : null;
      if (btnToClick) setTimeout(() => { try { btnToClick.click(); } catch (e) {} }, 300);
    };
  }

  /* ---------------------------------------------------------------------
     14) Start
     --------------------------------------------------------------------- */
  function init() {
    initFilters();
    // šipku nahoru vytváří společný site.js; odsud jen obnovíme její stav
    initToggleCols(() => { if (window.__bttRefresh) window.__bttRefresh(); });

    const xlsBtn = $('#exportBtn');
    if (xlsBtn) xlsBtn.addEventListener('click', withButtonBusy(xlsBtn, 'Generuji Excel...', () => exportXLSX()));
    const pdfBtn = $('#exportPdfBtn');
    if (pdfBtn) pdfBtn.addEventListener('click', withButtonBusy(pdfBtn, 'Generuji PDF...', () => exportPDF()));

    const runAutoExport = initInAppPatch();
    runAutoExport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
