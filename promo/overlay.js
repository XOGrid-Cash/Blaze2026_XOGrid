// Injected into every page of the recording (Playwright addInitScript). It draws the promo-only layers on top of the
// real site: title/end cards, a caption bar, a visible cursor and a black fade. Nothing here ships with the app.
(() => {
    if (window.__promo) return;

    const LOGO = '__LOGO_DATA_URI__';
    const startBlack = location.hostname !== 'localhost';
    const showTitle = location.hostname === 'localhost';

    const css = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
#promo-root, #promo-root * { box-sizing: border-box; font-family: 'Space Grotesk', system-ui, sans-serif; }
#promo-root { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
#promo-fade { position: absolute; inset: 0; background: #05070B; opacity: 0; transition: opacity 450ms ease; }
#promo-card { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column;
  background: radial-gradient(1200px 700px at 50% 45%, #1a1206 0%, #07090d 55%, #05070B 100%); color: #fff;
  opacity: 0; transition: opacity 600ms ease; text-align: center; }
#promo-card.on { opacity: 1; }
#promo-card .grid { position: absolute; inset: 0; opacity: .25;
  background-image: linear-gradient(rgba(249,115,22,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(249,115,22,.10) 1px, transparent 1px);
  background-size: 64px 64px; mask-image: radial-gradient(circle at 50% 45%, #000 0%, transparent 70%); }
#promo-card .inner { position: relative; transform: translateY(14px); transition: transform 900ms cubic-bezier(.2,.7,.2,1); }
#promo-card.on .inner { transform: translateY(0); }
#promo-card img { height: 120px; }
#promo-card .kicker { margin-top: 36px; letter-spacing: .32em; font-size: 20px; font-weight: 600; color: #fb923c; text-transform: uppercase; }
#promo-card h1 { margin: 18px 0 0; font-size: 92px; line-height: 1.02; font-weight: 700; letter-spacing: -0.03em; }
#promo-card h1 em { font-style: normal; background: linear-gradient(90deg,#fdba74,#f97316,#fbbf24); -webkit-background-clip: text; background-clip: text; color: transparent; }
#promo-card p { margin: 26px 0 0; font-size: 28px; color: #cbd5e1; }
#promo-card .rows { margin-top: 44px; display: grid; gap: 14px; font-size: 24px; color: #e2e8f0; }
#promo-card .rows code { font-family: ui-monospace, Consolas, monospace; font-size: 22px; color: #fdba74; }
#promo-card .rows span { color: #94a3b8; margin-right: 12px; }
#promo-cap { position: absolute; left: 50%; bottom: 56px; transform: translate(-50%, 20px); opacity: 0;
  transition: opacity 380ms ease, transform 380ms ease; padding: 18px 34px; border-radius: 18px;
  background: rgba(5,7,11,.86); border: 1px solid rgba(249,115,22,.45); box-shadow: 0 20px 60px rgba(0,0,0,.55), 0 0 0 6px rgba(249,115,22,.06);
  color: #fff; font-size: 38px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; backdrop-filter: blur(8px); }
#promo-cap.on { opacity: 1; transform: translate(-50%, 0); }
#promo-cap b { color: #fb923c; font-weight: 700; }
#promo-cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px; transform: translate(-200px,-200px); transition: none; }
#promo-cursor svg { filter: drop-shadow(0 3px 6px rgba(0,0,0,.6)); }
#promo-cursor .ring { position: absolute; left: -16px; top: -16px; width: 32px; height: 32px; border-radius: 50%;
  border: 3px solid #fb923c; opacity: 0; transform: scale(.4); }
#promo-cursor .ring.go { animation: promo-ring 520ms ease-out; }
@keyframes promo-ring { 0% { opacity: .95; transform: scale(.4); } 100% { opacity: 0; transform: scale(1.6); } }
`;

    const cards = {
        title: `<div class="grid"></div><div class="inner">
  <img src="${LOGO}" alt="">
  <div class="kicker">BCH BLAZE 2026</div>
  <h1>The registry for<br><em>XO templates.</em></h1>
  <p>Publish, inspect and trust Bitcoin Cash wallet templates.</p></div>`,
        end: `<div class="grid"></div><div class="inner">
  <img src="${LOGO}" alt="">
  <h1 style="font-size:76px;margin-top:34px">Explore. Publish. <em>Build trust.</em></h1>
  <div class="rows">
    <div><span>Code</span><code>github.com/XOGrid-Cash/Blaze2026_XOGrid</code></div>
    <div><span>EMBER2026</span><code>bitcoincash:zqvx6mew37u62g3zvzfwn38y4vfce9dkug7jlkxatw</code></div>
  </div>
  <div class="kicker" style="margin-top:48px">Built for BCH BLAZE 2026</div></div>`,
    };

    const mount = () => {
        const root = document.createElement('div');
        root.id = 'promo-root';
        root.innerHTML = `<style>${css}</style><div id="promo-card"></div><div id="promo-cap"></div>
<div id="promo-cursor"><div class="ring"></div><svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4 3.9 7.3-2.6 1.4-3.9-7.3L5 19z" fill="#fff" stroke="#05070B" stroke-width="1.4" stroke-linejoin="round"/></svg></div>
<div id="promo-fade"></div>`;
        document.documentElement.appendChild(root);

        const card = root.querySelector('#promo-card');
        const cap = root.querySelector('#promo-cap');
        const cursor = root.querySelector('#promo-cursor');
        const ring = cursor.querySelector('.ring');
        const fade = root.querySelector('#promo-fade');

        if (startBlack) { fade.style.transition = 'none'; fade.style.opacity = '1'; requestAnimationFrame(() => (fade.style.transition = '')); }
        if (showTitle) { card.innerHTML = cards.title; card.style.transition = 'none'; card.classList.add('on'); requestAnimationFrame(() => (card.style.transition = '')); }

        addEventListener('mousemove', (e) => (cursor.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`), true);
        addEventListener('mousedown', () => { ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); }, true);

        const wait = (ms) => new Promise((r) => setTimeout(r, ms));

        window.__promo = {
            async caption(html) {
                if (cap.classList.contains('on')) { cap.classList.remove('on'); await wait(380); }
                if (!html) return;
                cap.innerHTML = html;
                cap.classList.add('on');
            },
            async card(name) {
                if (name) { card.innerHTML = cards[name]; void card.offsetWidth; card.classList.add('on'); }
                else card.classList.remove('on');
                await wait(650);
            },
            async fade(on) { fade.style.opacity = on ? '1' : '0'; await wait(480); },
            scrollTo(y, ms = 1200) {
                const from = scrollY, to = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight));
                const t0 = performance.now();
                const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
                return new Promise((done) => {
                    const step = (now) => {
                        const t = Math.min(1, (now - t0) / ms);
                        window.scrollTo({ top: from + (to - from) * ease(t), behavior: 'instant' });
                        t < 1 ? requestAnimationFrame(step) : done();
                    };
                    requestAnimationFrame(step);
                });
            },
            go(path) { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); },
        };
    };

    if (document.documentElement) mount();
    else document.addEventListener('readystatechange', mount, { once: true });
})();
