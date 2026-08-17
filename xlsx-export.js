/* =========================================================================
   Vlastní tvorba XLSX bez externí knihovny.
   Soubor .xlsx je jen ZIP s několika XML soubory – vyrobíme si je sami.
   Výhoda: žádná 926kB knihovna, funguje i při otevření z disku (file://).
   Formátování odpovídá vzorové tabulce: šířky sloupců, tučná hlavička
   s béžovou výplní, zelená výplň sloupce ČAS, zmrazený řádek, filtr.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------- CRC32 (potřeba pro ZIP) ---------- */
  const crcTabulka = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bajty) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bajty.length; i++) c = crcTabulka[(c ^ bajty[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const kodovac = new TextEncoder();

  /* ---------- Minimální ZIP s deflate kompresí ----------
     XLSX je ZIP plný XML, které se komprimuje zhruba 10:1. Používáme
     nativní CompressionStream (Chrome 80+, Firefox 113+, Safari 16.4+);
     ve starých prohlížečích se automaticky uloží nekomprimovaně, takže
     soubor je vždy platný, jen větší. */
  const lzeKomprimovat = (typeof CompressionStream === 'function');

  async function deflatuj(data) {
    if (!lzeKomprimovat) return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const stream = new Blob([data]).stream().pipeThrough(cs);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      console.warn('[xlsx] komprese selhala, ukládám nekomprimovaně', e);
      return null;
    }
  }

  async function vytvorZip(soubory) {
    const kusy = [];
    const zaznamy = [];
    let posun = 0;

    const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
    const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

    for (const { nazev, obsah } of soubory) {
      const jmenoB = kodovac.encode(nazev);
      const dataB = typeof obsah === 'string' ? kodovac.encode(obsah) : obsah;
      const crc = crc32(dataB);                 // CRC vždy z PŮVODNÍCH dat

      // Zkusit zkomprimovat; když by výsledek nebyl menší, uložit napřímo.
      const zkomprimovana = await deflatuj(dataB);
      const pouzitKompresi = !!zkomprimovana && zkomprimovana.length < dataB.length;
      const telo = pouzitKompresi ? zkomprimovana : dataB;
      const metoda = pouzitKompresi ? 8 : 0;    // 8 = deflate, 0 = store

      const lokalni = new Uint8Array([
        0x50, 0x4B, 0x03, 0x04,      // podpis
        ...u16(20), ...u16(0x0800),  // verze, příznak UTF-8
        ...u16(metoda),
        ...u16(0), ...u16(0),        // čas, datum
        ...u32(crc), ...u32(telo.length), ...u32(dataB.length),
        ...u16(jmenoB.length), ...u16(0),
      ]);

      kusy.push(lokalni, jmenoB, telo);
      zaznamy.push({
        nazev: jmenoB, crc, metoda,
        delkaKomp: telo.length, delkaOrig: dataB.length, posun,
      });
      posun += lokalni.length + jmenoB.length + telo.length;
    }

    const centralniZacatek = posun;
    for (const z of zaznamy) {
      const hlavicka = new Uint8Array([
        0x50, 0x4B, 0x01, 0x02,
        ...u16(20), ...u16(20), ...u16(0x0800),
        ...u16(z.metoda), ...u16(0), ...u16(0),
        ...u32(z.crc), ...u32(z.delkaKomp), ...u32(z.delkaOrig),
        ...u16(z.nazev.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0),
        ...u32(z.posun),
      ]);
      kusy.push(hlavicka, z.nazev);
      posun += hlavicka.length + z.nazev.length;
    }

    kusy.push(new Uint8Array([
      0x50, 0x4B, 0x05, 0x06,
      ...u16(0), ...u16(0),
      ...u16(zaznamy.length), ...u16(zaznamy.length),
      ...u32(posun - centralniZacatek), ...u32(centralniZacatek), ...u16(0),
    ]));

    let celkem = 0;
    for (const k of kusy) celkem += k.length;
    const vysledek = new Uint8Array(celkem);
    let p = 0;
    for (const k of kusy) { vysledek.set(k, p); p += k.length; }
    return vysledek;
  }

  /* ---------- Pomocné ---------- */
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');   // znaky, které XLSX nepovoluje

  function sloupecPismeno(n) {          // 1 -> A, 27 -> AA
    let s = '';
    while (n > 0) { const z = (n - 1) % 26; s = String.fromCharCode(65 + z) + s; n = (n - z - 1) / 26; }
    return s;
  }

  /* ---------- Hlavní funkce ---------- */
  /**
   * @param {Array<Array<string>>} data  první řádek = hlavička
   * @param {Object} nast  { nazevListu, sirky, barvaHlavicky, sloupecVyplne, barvaVyplne }
   * @returns {Promise<Blob>} hotový soubor .xlsx (komprese je asynchronní)
   */
  async function vytvorXLSX(data, nast) {
    const o = Object.assign({
      nazevListu: 'List1',
      sirky: [],
      barvaHlavicky: 'FFFDEADA',
      sloupecVyplne: 0,          // 1 = A, 6 = F; 0 = nepoužít
      barvaVyplne: 'FFEBF1DE',
      pismo: 'Calibri',
      velikost: 12,
    }, nast || {});

    const pocetSloupcu = Math.max(...data.map((r) => r.length));

    /* --- styly --- */
    const styles =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2">' +
        `<font><sz val="${o.velikost}"/><name val="${esc(o.pismo)}"/><family val="2"/></font>` +
        `<font><b/><sz val="${o.velikost}"/><name val="${esc(o.pismo)}"/><family val="2"/></font>` +
      '</fonts>' +
      '<fills count="4">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        `<fill><patternFill patternType="solid"><fgColor rgb="${o.barvaHlavicky}"/><bgColor indexed="64"/></patternFill></fill>` +
        `<fill><patternFill patternType="solid"><fgColor rgb="${o.barvaVyplne}"/><bgColor indexed="64"/></patternFill></fill>` +
      '</fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';

    /* --- list --- */
    let cols = '';
    if (o.sirky.length) {
      cols = '<cols>' + o.sirky.slice(0, pocetSloupcu).map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
    }

    let radky = '';
    data.forEach((radek, ri) => {
      const cisloRadku = ri + 1;
      let bunky = '';
      for (let ci = 0; ci < pocetSloupcu; ci++) {
        const hodnota = radek[ci];
        const adresa = sloupecPismeno(ci + 1) + cisloRadku;
        let styl = 0;
        if (ri === 0) styl = 1;
        else if (o.sloupecVyplne && ci + 1 === o.sloupecVyplne) styl = 2;
        if (hodnota === undefined || hodnota === null || hodnota === '') {
          if (styl) bunky += `<c r="${adresa}" s="${styl}"/>`;
          continue;
        }
        bunky += `<c r="${adresa}"${styl ? ` s="${styl}"` : ''} t="inlineStr">` +
                 `<is><t xml:space="preserve">${esc(hodnota)}</t></is></c>`;
      }
      radky += `<row r="${cisloRadku}">${bunky}</row>`;
    });

    const poslednisl = sloupecPismeno(pocetSloupcu);
    const sheet =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<dimension ref="A1:${poslednisl}${data.length}"/>` +
      '<sheetViews><sheetView workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      cols +
      `<sheetData>${radky}</sheetData>` +
      `<autoFilter ref="A1:${poslednisl}1"/>` +
      '</worksheet>';

    const workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${esc(o.nazevListu).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>` +
      '</workbook>';

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    const wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const zip = await vytvorZip([
      { nazev: '[Content_Types].xml', obsah: contentTypes },
      { nazev: '_rels/.rels', obsah: rels },
      { nazev: 'xl/workbook.xml', obsah: workbook },
      { nazev: 'xl/_rels/workbook.xml.rels', obsah: wbRels },
      { nazev: 'xl/styles.xml', obsah: styles },
      { nazev: 'xl/worksheets/sheet1.xml', obsah: sheet },
    ]);

    return new Blob([zip], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  window.vytvorXLSX = vytvorXLSX;
})();
