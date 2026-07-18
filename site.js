/* O Přeborníka Boudy — společný skript (bez závislostí)
   1) mobilní menu, 2) vyskakovací karty „Další dosažené časy" i na dotyk */
(function () {
  'use strict';

  function init() {
    /* --- Back-to-top šipka: jednotná pro celý web (i pro stránku výsledků,
       kde se na mobilu v režimu všech sloupců scrolluje uvnitř tabulky) --- */
    if (!document.getElementById('backToTop')) {
      const btt = document.createElement('button');
      btt.id = 'backToTop';
      btt.type = 'button';
      btt.setAttribute('aria-label', 'Zpět nahoru');
      btt.title = 'Zpět nahoru';
      btt.setAttribute('data-html2canvas-ignore', 'true');
      btt.textContent = '▲';
      document.body.appendChild(btt);

      const SHOW_AFTER = 200;
      const wrap = document.getElementById('resultsWrapper');
      const mq = window.matchMedia('(max-width: 768px)');
      const scroller = () =>
        (mq.matches && document.body.classList.contains('show-all-cols') && wrap) ? wrap : window;
      const onScroll = () => {
        const src = scroller();
        const poz = (src === window) ? (window.scrollY || 0) : src.scrollTop;
        btt.classList.toggle('show', poz > SHOW_AFTER);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      if (wrap) wrap.addEventListener('scroll', onScroll, { passive: true });
      if (mq.addEventListener) mq.addEventListener('change', onScroll); else mq.addListener(onScroll);
      btt.addEventListener('click', () => scroller().scrollTo({ top: 0, behavior: 'smooth' }));
      onScroll();
      window.__bttRefresh = onScroll;
    }

    /* --- Mobilní menu --- */
    const prepinac = document.querySelector('.nav-prepinac');
    const nav = document.querySelector('.hlavni-nav');
    if (prepinac && nav) {
      prepinac.addEventListener('click', () => {
        const otevrene = nav.classList.toggle('otevrene');
        prepinac.setAttribute('aria-expanded', otevrene ? 'true' : 'false');
      });
      // zavřít po kliknutí na odkaz
      nav.addEventListener('click', (e) => {
        if (e.target.closest('a')) {
          nav.classList.remove('otevrene');
          prepinac.setAttribute('aria-expanded', 'false');
        }
      });
    }

    /* --- Rekordy: karta s dalšími časy na dotykových zařízeních ---
       Na desktopu funguje :hover z CSS. Na mobilu první ťuknutí kartu
       otevře, ťuknutí mimo ni (nebo Escape) ji zavře. Odkazy na velké
       fotky uvnitř karty fungují normálně. */
    const spouste = document.querySelectorAll('.foto-spoust');
    if (spouste.length) {
      const dotykove = window.matchMedia('(hover: none)');
      const zavriVse = () => {
        document.querySelectorAll('.foto-bunka.otevrena').forEach((b) => b.classList.remove('otevrena'));
      };
      spouste.forEach((odkaz) => {
        odkaz.addEventListener('click', (e) => {
          if (!dotykove.matches) return; // na desktopu hover řeší CSS, klik = velká fotka
          const bunka = odkaz.closest('.foto-bunka');
          if (bunka.classList.contains('otevrena')) return; // druhé ťuknutí -> otevřít fotku
          e.preventDefault();
          zavriVse();
          bunka.classList.add('otevrena');
          e.stopPropagation();
        });
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.dalsi-casy')) zavriVse();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') zavriVse();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
