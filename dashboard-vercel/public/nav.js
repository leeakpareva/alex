(function() {
  const p = location.pathname;
  const nav = document.createElement('nav');
  nav.id = 'site-nav';
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="/" class="nav-brand">ALEX<span class="nav-brand-sub">NAVADA</span></a>
      <button class="nav-toggle" id="nav-toggle" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
      <div class="nav-links" id="nav-links">
        <a href="/" class="nav-link${p === '/' || p === '/home.html' ? ' active' : ''}">Home</a>
        <a href="/dashboard" class="nav-link${p === '/dashboard' || p === '/index.html' ? ' active' : ''}">Dashboard</a>
        <a href="/api-library" class="nav-link${p === '/api-library' ? ' active' : ''}">API Library</a>
        <a href="/chat" class="nav-link${p === '/chat' ? ' active' : ''}">Chat</a>
        <a href="/experiment" class="nav-link${p.startsWith('/experiment') ? ' active' : ''}">Experiment</a>
        <a href="/live-log" class="nav-link${p === '/live-log' ? ' active' : ''}">Live Log</a>
        <a href="/articles" class="nav-link${p.startsWith('/articles') ? ' active' : ''}">Articles</a>
        <a href="/contact" class="nav-link${p === '/contact' ? ' active' : ''}">Contact</a>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #site-nav {
      background: oklch(0.12 0.02 290);
      border-bottom: 1px solid oklch(0.3 0.08 290);
      position: sticky;
      top: 0;
      z-index: 999;
      font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .nav-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
    }
    .nav-brand {
      font-size: 1rem;
      font-weight: 700;
      color: oklch(0.95 0.02 290);
      text-decoration: none;
      letter-spacing: 1px;
    }
    .nav-brand-sub {
      color: oklch(0.75 0.25 330);
      font-weight: 400;
      margin-left: 2px;
      font-size: 0.8rem;
    }
    .nav-links {
      display: flex;
      gap: 0.25rem;
    }
    .nav-link {
      color: oklch(0.65 0.1 290);
      text-decoration: none;
      font-size: 0.8rem;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      transition: color 0.2s, background 0.2s;
    }
    .nav-link:hover {
      color: oklch(0.7 0.2 195);
      background: oklch(0.7 0.2 195 / 0.08);
    }
    .nav-link.active {
      color: oklch(0.75 0.25 330);
      background: oklch(0.75 0.25 330 / 0.1);
    }
    .nav-toggle {
      display: none;
      flex-direction: column;
      gap: 4px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
    }
    .nav-toggle span {
      width: 20px;
      height: 2px;
      background: oklch(0.65 0.1 290);
      border-radius: 1px;
      transition: transform 0.2s, opacity 0.2s;
    }
    @media (max-width: 600px) {
      .nav-toggle { display: flex; }
      .nav-links {
        display: none;
        position: absolute;
        top: 48px;
        left: 0;
        right: 0;
        background: oklch(0.12 0.02 290);
        border-bottom: 1px solid oklch(0.3 0.08 290);
        flex-direction: column;
        padding: 0.5rem;
      }
      .nav-links.open { display: flex; }
      .nav-link { padding: 0.6rem 1rem; }
    }
  `;

  document.head.appendChild(style);
  document.body.prepend(nav);

  document.getElementById('nav-toggle').addEventListener('click', function() {
    document.getElementById('nav-links').classList.toggle('open');
  });

  // Cookie consent banner
  if (!localStorage.getItem('alex-cookie-consent')) {
    const banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;justify-content:center">
        <span style="font-size:0.8rem;color:oklch(0.85 0.02 290);flex:1;min-width:200px">
          This site uses cookies and local storage for functionality and analytics.
        </span>
        <button id="cookie-accept" style="
          background:oklch(0.75 0.25 330);color:#fff;border:none;padding:0.45rem 1.25rem;
          border-radius:6px;font-size:0.75rem;font-weight:600;cursor:pointer;white-space:nowrap;
          transition:background 0.2s;
        ">Accept</button>
      </div>
    `;
    const bStyle = document.createElement('style');
    bStyle.textContent = `
      #cookie-banner {
        position:fixed;bottom:0;left:0;right:0;z-index:10000;
        background:oklch(0.1 0.02 290 / 0.85);
        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
        border-top:1px solid oklch(0.3 0.08 290);
        padding:0.75rem 1.25rem;
        animation:cookieSlide 0.4s ease-out;
      }
      #cookie-accept:hover { background:oklch(0.8 0.25 330); }
      @keyframes cookieSlide { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
    `;
    document.head.appendChild(bStyle);
    document.body.appendChild(banner);
    document.getElementById('cookie-accept').addEventListener('click', function() {
      localStorage.setItem('alex-cookie-consent', '1');
      banner.remove();
    });
  }
})();
