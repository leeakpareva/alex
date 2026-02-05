(function() {
  if (document.getElementById('alex-chat-widget')) return;

  const widget = document.createElement('div');
  widget.id = 'alex-chat-widget';
  widget.innerHTML = `
    <button id="acw-toggle" aria-label="Chat with ALEX">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
    <div id="acw-panel" class="acw-hidden">
      <div id="acw-header">
        <span>Chat with ALEX</span>
        <button id="acw-close" aria-label="Close">&times;</button>
      </div>
      <div id="acw-messages"></div>
      <div id="acw-input-wrap">
        <input type="text" id="acw-input" placeholder="Ask ALEX anything..." maxlength="2000" />
        <button id="acw-send">Send</button>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #alex-chat-widget { position: fixed; bottom: 20px; right: 20px; z-index: 10000; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif; }
    #acw-toggle {
      width: 52px; height: 52px; border-radius: 50%; border: none;
      background: oklch(0.75 0.25 330); color: oklch(0.12 0.02 290); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 10px oklch(0.75 0.25 330), 0 0 20px oklch(0.75 0.25 330 / 0.4);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #acw-toggle:hover {
      transform: scale(1.1);
      box-shadow: 0 0 15px oklch(0.75 0.25 330), 0 0 30px oklch(0.75 0.25 330 / 0.5);
    }
    #acw-panel {
      position: absolute; bottom: 64px; right: 0;
      width: 360px; max-height: 480px;
      background: oklch(0.15 0.03 290); border: 1px solid oklch(0.3 0.08 290); border-radius: 12px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    #acw-panel.acw-hidden { display: none; }
    #acw-header {
      padding: 12px 16px; background: oklch(0.12 0.02 290); border-bottom: 1px solid oklch(0.3 0.08 290);
      display: flex; justify-content: space-between; align-items: center;
      color: oklch(0.95 0.02 290); font-size: 14px; font-weight: 600;
    }
    #acw-close { background: none; border: none; color: oklch(0.65 0.1 290); font-size: 20px; cursor: pointer; padding: 0 4px; }
    #acw-close:hover { color: oklch(0.95 0.02 290); }
    #acw-messages {
      flex: 1; overflow-y: auto; padding: 12px; min-height: 280px; max-height: 340px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .acw-msg {
      max-width: 80%; padding: 8px 12px; border-radius: 12px;
      font-size: 13px; line-height: 1.4; word-wrap: break-word; white-space: pre-wrap;
    }
    .acw-msg.user { align-self: flex-end; background: oklch(0.75 0.25 330); color: oklch(0.12 0.02 290); border-bottom-right-radius: 4px; }
    .acw-msg.alex { align-self: flex-start; background: oklch(0.2 0.04 290); color: oklch(0.95 0.02 290); border-bottom-left-radius: 4px; }
    .acw-msg.system { align-self: center; color: oklch(0.65 0.1 290); font-size: 11px; background: none; }
    .acw-typing { color: oklch(0.65 0.1 290); font-size: 12px; padding: 4px 12px; }
    .acw-typing::after { content: '...'; animation: acw-dots 1.5s infinite; }
    @keyframes acw-dots { 0% { content: '.'; } 33% { content: '..'; } 66% { content: '...'; } }
    #acw-input-wrap {
      padding: 8px 12px; border-top: 1px solid oklch(0.3 0.08 290);
      display: flex; gap: 8px; background: oklch(0.12 0.02 290);
    }
    #acw-input {
      flex: 1; background: oklch(0.2 0.04 290); border: 1px solid oklch(0.3 0.08 290); border-radius: 8px;
      color: oklch(0.95 0.02 290); padding: 8px 12px; font-size: 13px; outline: none;
      font-family: 'Space Grotesk', sans-serif;
    }
    #acw-input:focus { border-color: oklch(0.75 0.25 330); }
    #acw-send {
      background: oklch(0.75 0.25 330); color: oklch(0.12 0.02 290); border: none; border-radius: 8px;
      padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 500;
      font-family: 'Space Grotesk', sans-serif;
    }
    #acw-send:hover { opacity: 0.9; }
    #acw-send:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (max-width: 480px) {
      #acw-panel { width: calc(100vw - 40px); right: 0; bottom: 64px; }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(widget);

  // State
  let sessionId = localStorage.getItem('acw-session');
  if (!sessionId) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : 'ses-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('acw-session', sessionId);
  }
  let polling = false;

  const toggle = document.getElementById('acw-toggle');
  const panel = document.getElementById('acw-panel');
  const closeBtn = document.getElementById('acw-close');
  const input = document.getElementById('acw-input');
  const sendBtn = document.getElementById('acw-send');
  const messages = document.getElementById('acw-messages');

  toggle.addEventListener('click', () => {
    panel.classList.toggle('acw-hidden');
    if (!panel.classList.contains('acw-hidden')) input.focus();
  });
  closeBtn.addEventListener('click', () => panel.classList.add('acw-hidden'));

  function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = 'acw-msg ' + type;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendBtn.disabled = true;
    addMessage(text, 'user');

    const typing = document.createElement('div');
    typing.className = 'acw-typing';
    typing.textContent = 'ALEX is thinking';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;

    try {
      await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      });
      pollForResponse(typing);
    } catch (e) {
      typing.remove();
      addMessage('Failed to send message. Try again.', 'system');
      sendBtn.disabled = false;
    }
  }

  async function pollForResponse(typingEl) {
    if (polling) return;
    polling = true;
    let attempts = 0;
    const maxAttempts = 90;

    function schedulePoll() {
      attempts++;
      if (attempts > maxAttempts) {
        polling = false;
        typingEl.remove();
        addMessage('ALEX took too long to respond. Please try again.', 'system');
        sendBtn.disabled = false;
        return;
      }
      const delay = attempts <= 15 ? 1000 : 2000;
      setTimeout(async () => {
        try {
          const res = await fetch(`/api/chat/poll?sessionId=${encodeURIComponent(sessionId)}`);
          const data = await res.json();
          if (!data.pending && data.response) {
            polling = false;
            typingEl.remove();
            addMessage(data.response, 'alex');
            sendBtn.disabled = false;
            return;
          }
        } catch (e) { /* continue polling */ }
        schedulePoll();
      }, delay);
    }
    schedulePoll();
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
})();
