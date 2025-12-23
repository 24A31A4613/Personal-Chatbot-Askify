document.addEventListener('DOMContentLoaded', () => {
  // --- User Session ---
  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('currentUser')); } catch (e) { currentUser = null; }
  if (!currentUser) { window.location.assign('../login.html'); return; }

  const USER_EMAIL = currentUser.email; // used for API calls via header
  const FALLBACK_IMG = 'askify-logo.png';

  const API_BASE = "http://localhost:5000";
  const displayName =
    (currentUser && currentUser.username) ||
    (currentUser && currentUser.email ? currentUser.email.split('@')[0] : '') ||
    'User';
  const userAvatarUrl =
    currentUser.avatar ||
    (currentUser.gender === 'male'
      ? 'assets/avatars/male-1.png'
      : 'assets/avatars/female-1.png');

  // --- DOM Elements ---
  const profileName     = document.getElementById('profileName');
  const profileMonogram = document.getElementById('profileMonogram');
  const chatBox         = document.getElementById('chatBox');
  const input           = document.getElementById('userInput');
  const sendBtn         = document.getElementById('sendBtn');
  const newChatBtn      = document.getElementById('newChatBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const logoutBtn       = document.getElementById('logoutBtn');
  const scrollDownBtn   = document.getElementById('scrollDownBtn');
  const chatHistoryList = document.getElementById('chatHistoryList');
  const muteIcon        = document.getElementById('muteIcon');

  // optional elements (guarded)
  const attachBtn  = document.getElementById('attachBtn');
  const attachMenu = document.getElementById('attachMenu');
  const voiceBtn   = document.getElementById('voiceBtn');
  const themeIcon  = document.getElementById('themeIcon');

  if (profileName) profileName.textContent = displayName;
  if (profileMonogram) profileMonogram.textContent = (displayName[0] || 'U').toUpperCase();

  const nowTime = () =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const scrollToBottom = (smooth = true) => {
    if (!chatBox) return;
    try {
      chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    } catch (e) {
      chatBox.scrollTop = chatBox.scrollHeight;
    }
  };

  // Auto-resize input
  function fitTextarea() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }
  if (input) {
    input.addEventListener('input', fitTextarea);
    setTimeout(fitTextarea, 0);
  }

  // Scroll helper
  if (chatBox) {
    chatBox.addEventListener('scroll', () => {
      const nearBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 60;
      if (scrollDownBtn) scrollDownBtn.style.display = nearBottom ? 'none' : 'block';
    });
  }
  if (scrollDownBtn) scrollDownBtn.addEventListener('click', () => scrollToBottom(true));

  function attachFallback(img) {
    img.onerror = function () { this.onerror = null; this.src = FALLBACK_IMG; };
  }

  // --------------------------
  // Technical detection (same keywords)
  // --------------------------
  function isTechnicalQuestion(msg) {
    if (!msg) return false;
    msg = msg.toLowerCase();
    const keywords = [
      "what is", "explain", "define", "difference", "example",
      "how to", "program", "code", "python", "java", "c ",
      "c++", "javascript", "html", "css", "sql", "database", "algorithm"
    ];
    return keywords.some(k => msg.includes(k));
  }

  // --- Server-backed Chat Sessions ---
  let chatSessions = []; // fetched from server
  let activeSession = null; // { session_id: '...', messages: [...] } or null

  function apiHeaders() {
    return {
      "Content-Type": "application/json",
      "X-User-Email": USER_EMAIL
    };
  }

  async function fetchSessionsFromServer() {
    try {
      const res = await fetch(`${API_BASE}/api/get_sessions`, { headers: apiHeaders() });

      const j = await res.json();
      if (res.ok && j.sessions) {
        chatSessions = j.sessions; // array of { session_id, title, last_time }
        renderChatHistory();
      } else {
        console.warn("Could not fetch sessions", j);
      }
    } catch (err) {
      console.error("Error fetching sessions:", err);
    }
  }

  async function fetchMessages(session_id) {
    try {
      const res = await fetch(`${API_BASE}/api/get_messages/${session_id}`, { headers: apiHeaders() });
      const j = await res.json();
      if (res.ok && j.messages) {
        return j.messages; // list of {role,text,time}
      } else {
        console.warn("No messages:", j);
        return [];
      }
    } catch (err) {
      console.error("Error fetching messages:", err);
      return [];
    }
  }

  async function saveMessageToServer({ session_id = null, role, text, time }) {
    try {
      const body = { session_id, role, text, time };
      const res = await fetch(`${API_BASE}/api/save_message`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(body)
      });

      const j = await res.json();
      if (res.ok && j.session_id) {
        return j.session_id;
      } else {
        console.warn("saveMessage failed", j);
        return null;
      }
    } catch (err) {
      console.error("Error saving message:", err);
      return null;
    }
  }

  async function deleteSessionOnServer(session_id) {
    try {
      const res = await fetch(`${API_BASE}/api/delete_session/${session_id}`, {
        method: "DELETE",
        headers: apiHeaders()
      });

      const j = await res.json();
      if (res.ok) {
        // refresh
        await fetchSessionsFromServer();
      } else {
        console.warn("delete failed", j);
      }
    } catch (err) {
      console.error("Error deleting session:", err);
    }
  }

  // --- Render Sidebar ---
  function renderChatHistory() {
    if (!chatHistoryList) return;
    chatHistoryList.innerHTML = '';

    // chatSessions from server are ordered (server returns newest first)
    chatSessions.forEach(s => {
      const item = document.createElement('li');
      item.className = 'history-item';
      item.textContent = s.title || '(untitled)';

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = '×';
      delBtn.onclick = e => {
        e.stopPropagation();
        deleteSessionOnServer(s.session_id);
        if (activeSession && activeSession.session_id === s.session_id) {
          activeSession = null;
          if (chatBox) chatBox.innerHTML = '';
        }
      };
      item.appendChild(delBtn);

      item.onclick = async () => {
        // load session messages from server
        const msgs = await fetchMessages(s.session_id);
        activeSession = { session_id: s.session_id, messages: msgs };
        if (chatBox) chatBox.innerHTML = '';
        msgs.forEach(m => renderMessage(m.role, m.text, m.time, false));
      };

      chatHistoryList.appendChild(item);
    });

    chatHistoryList.style.overflowY = 'auto';
    chatHistoryList.style.maxHeight = 'calc(100vh - 180px)';
  }

  // --------------------------
  // --- Sound & Haptics ------
  // --------------------------
  const prefersReducedMotion = (typeof matchMedia === 'function') &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  let muted = localStorage.getItem('askifyMuted') === 'true';

  const keySound = new Audio('assets/audio/keypress.mp3');
  const sendSound = new Audio('assets/audio/send.mp3');
  try { keySound.volume = 0.6; sendSound.volume = 0.85; } catch (e) { }

  function tryPlay(a) { if (!muted && !prefersReducedMotion) { a.currentTime = 0; a.play().catch(() => { }); } }
  function playKeySound() { tryPlay(keySound); }
  function playSendSound() { tryPlay(sendSound); }

  function hapticSend() {
    if (muted || prefersReducedMotion) return;
    navigator.vibrate?.(10);
  }

  function updateMuteIcon() {
    if (!muteIcon) return;
    // ensure consistent classes
    muteIcon.classList.remove('fa-volume-up', 'fa-volume-mute');
    muteIcon.classList.add(muted ? 'fa-volume-mute' : 'fa-volume-up');
  }
  updateMuteIcon();
  if (muteIcon) muteIcon.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem('askifyMuted', String(muted));
    updateMuteIcon();
  });

  if (input) {
    input.addEventListener('keydown', e => {
      const printable = e.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(e.key);
      if (printable && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) playKeySound();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });
  }

  // --- Render Message (with resource rendering + double-click copy) ---
  function renderMessage(role, text, time, save = true) {
    if (!chatBox) return;
    const wrapper = document.createElement('div');
    wrapper.className = `message ${role === 'bot' ? 'bot-message' : 'user-message'}`;

    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.alt = role === 'bot' ? 'Bot' : 'You';
    avatar.src = role === 'bot' ? 'bot-avatar.png' : userAvatarUrl;
    attachFallback(avatar);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const textDiv = document.createElement('div');
    textDiv.className = 'text';

    // Resource rendering (unchanged)
    if (role === 'bot' && /\bhttps?:\/\/\S+/i.test(text)) {
      const lines = String(text).split("\n");
      lines.forEach(line => {
        const trimmed = line.trim();
        const m = trimmed.match(/^\-?\s*(https?:\/\/\S+)(?:\s+—\s+(.+))?/);
        if (m) {
          const url = m[1];
          const desc = m[2] || "";
          const a = document.createElement('a');
          a.href = url;
          a.textContent = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          textDiv.appendChild(a);
          if (desc) textDiv.appendChild(document.createTextNode(' — ' + desc));
          textDiv.appendChild(document.createElement('br'));
        } else {
          textDiv.appendChild(document.createTextNode(line));
          textDiv.appendChild(document.createElement('br'));
        }
      });
    } else {
      textDiv.textContent = text;
    }

    bubble.appendChild(textDiv);

    if (time) {
      const ts = document.createElement('div');
      ts.className = 'timestamp';
      ts.textContent = time;
      bubble.appendChild(ts);
    }

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    chatBox.appendChild(wrapper);
    scrollToBottom();

    if (role === 'bot') {
      playSendSound();
      hapticSend();
    }

    // Double-click to copy
    wrapper.addEventListener('dblclick', async () => {
      const toCopy = text;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(toCopy);
          wrapper.classList.add('copy-highlight');
          showCopyToast('Copied!');
        } else {
          const ta = document.createElement('textarea');
          ta.value = toCopy;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          wrapper.classList.add('copy-highlight');
          showCopyToast('Copied!');
        }
      } catch (err) {
        console.error('Copy failed:', err);
        showCopyToast('Copy failed');
      }
      setTimeout(() => wrapper.classList.remove('copy-highlight'), 800);
    });

    if (save && activeSession) {
      // local UI append; already persisted to server by flow
      activeSession.messages = activeSession.messages || [];
      activeSession.messages.push({ role, text, time: time || nowTime() });
    }
  }

  // Copy toast
  function showCopyToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'copy-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    toast.style.left = '50%';
    toast.style.bottom = '60px';
    toast.style.transform = 'translateX(-50%)';
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 1400);
  }

  // Typing indicator
  let typingEl = null;
  function showTyping() {
    if (typingEl || !chatBox) return;
    typingEl = document.createElement('div');
    typingEl.className = 'message bot-message typing';
    typingEl.innerHTML = `
      <img class="avatar" src="bot-avatar.png" alt="Bot">
      <div class="bubble">
        <div class="text">Askify is typing<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
      </div>`;
    chatBox.appendChild(typingEl);
    scrollToBottom();
  }
  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  // Welcome (we still show welcome in UI but no session saved until technical question)
  function showWelcome() {
    renderMessage(
      'bot',
      `Hey ${displayName}! I'm Askify — your friendly AI buddy. Let's start chatting!`,
      nowTime(),
      false
    );
  }

  // Send message to Gemini backend
  async function askBackendForReply(message) {
    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Email": USER_EMAIL   // 🔥 IMPORTANT
        },
        body: JSON.stringify({
          message,
          session_id: activeSession?.session_id || null
        }),
      });

      const data = await response.json();
      return data.reply || data.error || "Error: No reply from backend";
    } catch (err) {
      console.error(err);
      return "Error: Could not connect to backend";
    }
  }

  // --- Wrapper for sending and rendering (server-persisted) ---
  async function handleSendMessage() {
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    // Show the user message immediately in UI (no-save flag false for now)
    renderMessage('user', text, nowTime(), false);

    // If there's no activeSession, only create a server session when the user message is technical
    if (!activeSession) {
      if (!isTechnicalQuestion(text)) {
        // non-technical (greeting/small talk): ask backend but do not create session
        input.value = '';
        fitTextarea();
        showTyping();
        const reply = await askBackendForReply(text);
        hideTyping();
        renderMessage('bot', reply, nowTime(), false);
        return;
      } else {
        // technical -> create session on server by saving this user message
        const t = nowTime();
        const session_id = await saveMessageToServer({ session_id: null, role: 'user', text, time: t });
        if (!session_id) {
          showCopyToast('Failed to create session');
          return;
        }
        activeSession = { session_id, messages: [{ role: 'user', text, time: t }] };
        // refresh sessions list in sidebar
        await fetchSessionsFromServer();
      }
    } else {
      // activeSession exists: append user message to server
      const session_id = activeSession.session_id;
      const t = nowTime();
      const sid = await saveMessageToServer({ session_id, role: 'user', text, time: t });
      if (!sid) console.warn("Failed to save user message to server");
    }

    input.value = '';
    fitTextarea();

    // Ask the backend for reply
    showTyping();
    const reply = await askBackendForReply(text);
    hideTyping();

    // render bot reply in UI
    renderMessage('bot', reply, nowTime(), false);

    // save bot reply to server under same session
    if (activeSession && activeSession.session_id) {
      const t2 = nowTime();
      const sid = await saveMessageToServer({ session_id: activeSession.session_id, role: 'bot', text: reply, time: t2 });
      if (!sid) console.warn("Failed to save bot reply to server");
      // refresh sidebar so last time/title reflect this session
      await fetchSessionsFromServer();
    }
  }

  if (sendBtn) sendBtn.addEventListener('click', handleSendMessage);

  // Buttons
  if (newChatBtn) newChatBtn.addEventListener('click', () => {
    if (chatBox) chatBox.innerHTML = '';
    activeSession = null; // do not create session yet
    showWelcome();
    renderChatHistory();
  });

  if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', async () => {
    if (activeSession) {
      // delete only active session from server
      await deleteSessionOnServer(activeSession.session_id);
      activeSession = null;
      if (chatBox) chatBox.innerHTML = '';
      await fetchSessionsFromServer();
    } else {
      // nothing active
    }
  });

  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('currentUser');
    window.location.assign('../login.html');
  });

  // Attachment menu
  if (attachBtn && attachMenu) {
    attachBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      attachMenu.classList.toggle('show');
    });
    document.addEventListener('click', () => {
      attachMenu.classList.remove('show');
    });
    attachMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = e.target.closest('button')?.dataset.action;
      if (action) {
        alert(`Attachment option selected: ${action}\nBackend integration required.`);
        attachMenu.classList.remove('show');
      }
    });
    attachMenu.addEventListener('mousedown', e => e.preventDefault());
  }

  // 🎤 Voice input (Web Speech API)
  if (voiceBtn) {
    let recognition;
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        voiceBtn.classList.add("listening"); // add glowing/listening style
      };
      recognition.onend = () => {
        voiceBtn.classList.remove("listening"); // reset to normal mic icon
      };
      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        voiceBtn.classList.remove("listening");
      };
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        input.value = transcript;
        fitTextarea();
        handleSendMessage();
      };

      voiceBtn.addEventListener("click", () => {
        recognition.start();
      });
    } else {
      voiceBtn.addEventListener("click", () => {
        alert("Your browser does not support speech recognition.");
      });
    }
  }

  // --- Initialize UI: fetch sessions, show welcome (no session created yet) ---
  (async () => {
    await fetchSessionsFromServer();
    if (chatBox) chatBox.innerHTML = '';
    showWelcome();
  })();

  // Theme toggle
  const savedTheme = localStorage.getItem('askifyTheme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    if (themeIcon) {
      themeIcon.classList.remove('fa-moon');
      themeIcon.classList.add('fa-sun');
    }
  }
  if (themeIcon) {
    themeIcon.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      const isLight = document.body.classList.contains('light-theme');
      localStorage.setItem('askifyTheme', isLight ? 'light' : 'dark');
      themeIcon.classList.remove('fa-moon', 'fa-sun');
      themeIcon.classList.add(isLight ? 'fa-sun' : 'fa-moon');
    });
  }
});
