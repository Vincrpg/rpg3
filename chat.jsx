import { useState, useEffect, useRef, useCallback } from "react";

const MAX_MSGS = 150;
const POLL_MS = 3000;
const SKEY = "rpg-chat-v3";

const PAL = ['#7c6af7','#3ecf8e','#f0a060','#e8498a','#60c8f0','#c8a03c','#a060f0','#f06080','#40b8b8','#e06040'];
const hc  = n => { let h=0; for(const c of n) h=(h*31+c.charCodeAt(0))%PAL.length; return PAL[h]; };
const ini = n => n.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
const fmtT = t => new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

async function dbRead() {
  try {
    const r = await window.storage.get(SKEY, true);
    if (r && r.value) return JSON.parse(r.value);
  } catch {}
  return { messages: [], typing: {} };
}

async function dbWrite(data) {
  await window.storage.set(SKEY, JSON.stringify(data), true);
}

export default function Chat() {
  const [screen, setScreen] = useState("login"); // login | chat
  const [nameInput, setNameInput] = useState("");
  const [myName, setMyName] = useState(null);
  const [messages, setMessages] = useState([]);
  const [typingMap, setTypingMap] = useState({});
  const [msgInput, setMsgInput] = useState("");
  const [online, setOnline] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const lastCountRef = useRef(-1);
  const pollRef = useRef(null);
  const typingTimerRef = useRef(null);
  const myNameRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => { myNameRef.current = myName; }, [myName]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const poll = useCallback(async () => {
    try {
      const d = await dbRead();
      const msgs = d.messages || [];
      if (msgs.length !== lastCountRef.current) {
        lastCountRef.current = msgs.length;
        setMessages([...msgs]);
      }
      const now = Date.now();
      const active = {};
      Object.entries(d.typing || {}).forEach(([n, t]) => {
        if (n !== myNameRef.current && now - t < 5000) active[n] = t;
      });
      setTypingMap(active);
      setOnline(true);
    } catch { setOnline(false); }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(poll, POLL_MS);
  }, [poll]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const enter = async () => {
    const name = nameInput.trim();
    if (!name) return;
    setLoading(true);
    setError("");
    try {
      const d = await dbRead();
      const msgs = [...(d.messages || [])];
      msgs.push({ type: "system", text: `${name} entrou na sala.`, ts: Date.now() });
      if (msgs.length > MAX_MSGS) msgs.splice(0, msgs.length - MAX_MSGS);
      await dbWrite({ messages: msgs, typing: d.typing || {} });
      setMyName(name);
      setMessages(msgs);
      lastCountRef.current = msgs.length;
      setScreen("chat");
      startPolling();
    } catch (e) {
      setError("Erro ao conectar: " + (e?.message || "tente novamente"));
    }
    setLoading(false);
  };

  const sendMsg = async () => {
    const text = msgInput.trim();
    if (!text || !myNameRef.current) return;
    setMsgInput("");
    try {
      const d = await dbRead();
      const msgs = [...(d.messages || [])];
      msgs.push({ name: myNameRef.current, text, ts: Date.now(), type: "msg" });
      if (msgs.length > MAX_MSGS) msgs.splice(0, msgs.length - MAX_MSGS);
      const typing = { ...(d.typing || {}) };
      delete typing[myNameRef.current];
      await dbWrite({ messages: msgs, typing });
      lastCountRef.current = -1;
      await poll();
    } catch (e) { console.error(e); }
  };

  const updateTyping = async (active) => {
    if (!myNameRef.current) return;
    try {
      const d = await dbRead();
      const typing = { ...(d.typing || {}) };
      if (active) typing[myNameRef.current] = Date.now();
      else delete typing[myNameRef.current];
      await dbWrite({ ...d, typing });
    } catch {}
  };

  const exitChat = async () => {
    stopPolling();
    clearTimeout(typingTimerRef.current);
    try {
      const d = await dbRead();
      const msgs = [...(d.messages || [])];
      msgs.push({ type: "system", text: `${myNameRef.current} saiu da sala.`, ts: Date.now() });
      const typing = { ...(d.typing || {}) };
      delete typing[myNameRef.current];
      await dbWrite({ messages: msgs, typing });
    } catch {}
    setMyName(null);
    setMessages([]);
    lastCountRef.current = -1;
    setScreen("login");
    setNameInput("");
  };

  const handleInputKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  };

  const handleTyping = (e) => {
    setMsgInput(e.target.value);
    clearTimeout(typingTimerRef.current);
    if (e.target.value.length > 0) {
      updateTyping(true);
      typingTimerRef.current = setTimeout(() => updateTyping(false), 2500);
    } else {
      updateTyping(false);
    }
  };

  const typingNames = Object.keys(typingMap);

  // ── Render helpers ─────────────────────────────────────────────────────────
  function renderMessages() {
    const groups = [];
    let prevName = null, prevGroup = null;
    for (const m of messages) {
      if (m.type === "system") {
        groups.push(
          <div key={m.ts + m.text} style={{
            textAlign:"center", fontFamily:"'Share Tech Mono',monospace",
            fontSize:10, letterSpacing:"0.1em", color:"#333340", padding:"8px 0"
          }}>
            <span style={{color:"#4a3fa0"}}>{m.text}</span>
          </div>
        );
        prevName = null; prevGroup = null; continue;
      }
      const own = m.name === myName;
      if (m.name !== prevName) {
        const group = {
          key: m.ts + m.name, own, name: m.name,
          color: hc(m.name), firstTs: m.ts, bubbles: []
        };
        groups.push(group);
        prevGroup = group; prevName = m.name;
      }
      prevGroup.bubbles.push({ text: m.text, ts: m.ts });
    }

    return groups.map(g => {
      if (g.text !== undefined) return g; // system msg already a JSX element
      return (
        <div key={g.key} style={{
          display:"flex", flexDirection:"column", marginBottom:12,
          alignItems: g.own ? "flex-end" : "flex-start"
        }}>
          <div style={{
            display:"flex", alignItems:"baseline", gap:10,
            flexDirection: g.own ? "row-reverse" : "row",
            marginBottom:4, padding:"0 4px"
          }}>
            <span style={{fontWeight:600, fontSize:13, color:g.color}}>{g.name}</span>
            <span style={{fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:"#333340"}}>{fmtT(g.firstTs)}</span>
          </div>
          {g.bubbles.map((b, i) => (
            <div key={i} style={{
              background: g.own ? "#1e1a3a" : "#18181e",
              border: `1px solid ${g.own ? "#4a3fa0" : "#252530"}`,
              borderRadius: g.own ? "8px 2px 8px 8px" : "2px 8px 8px 8px",
              padding:"10px 14px", fontSize:14, lineHeight:1.6,
              color:"#e8e8f0", maxWidth:580, wordBreak:"break-word",
              marginBottom: i < g.bubbles.length-1 ? 3 : 0
            }}>{b.text}</div>
          ))}
        </div>
      );
    });
  }

  const s = {
    bg: "#0c0c0e", panel: "#16161a", border: "#252530", border2: "#2e2e3a",
    text: "#e8e8f0", dim: "#6a6a80", dimmer: "#333340",
    accent: "#7c6af7", accentDim: "#4a3fa0", green: "#3ecf8e", red: "#f06060",
    bg2: "#111115",
  };

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  if (screen === "login") return (
    <div style={{
      position:"fixed", inset:0, background:s.bg,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'IBM Plex Sans',sans-serif"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #2e2e3a; }
      `}</style>
      <div style={{
        background:s.panel, border:`1px solid ${s.border2}`,
        padding:"48px 52px", width:"100%", maxWidth:420,
        display:"flex", flexDirection:"column", gap:20, position:"relative"
      }}>
        <div style={{
          position:"absolute", top:0, left:0, right:0, height:2,
          background:`linear-gradient(to right, ${s.accentDim}, ${s.accent}, ${s.accentDim})`
        }}/>
        <div style={{fontFamily:"'Share Tech Mono',monospace", fontSize:11, letterSpacing:"0.3em", color:s.accent, textTransform:"uppercase"}}>// Sistema de Chat</div>
        <div style={{fontSize:22, fontWeight:600, color:s.text}}>Entre na conversa</div>
        <div style={{fontSize:13, color:s.dim, fontStyle:"italic", marginTop:-8}}>Escolha um nome para entrar na sala.</div>
        <div style={{display:"flex", flexDirection:"column", gap:8}}>
          <label style={{fontFamily:"'Share Tech Mono',monospace", fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase", color:s.dim}}>Seu nome</label>
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter") enter(); }}
            placeholder="Ex: Connor McGragor"
            maxLength={32}
            autoComplete="off"
            style={{
              background:s.bg2, border:`1px solid ${s.border}`, padding:"11px 14px",
              color:s.text, fontFamily:"'IBM Plex Sans',sans-serif", fontSize:15, width:"100%",
              transition:"border-color 0.2s"
            }}
          />
        </div>
        {error && <div style={{fontSize:12, color:s.red, fontStyle:"italic", textAlign:"center"}}>{error}</div>}
        <button
          onClick={enter}
          disabled={loading || !nameInput.trim()}
          style={{
            background: s.accent, border:"none", padding:12, color:"#fff",
            fontFamily:"'Share Tech Mono',monospace", fontSize:12, letterSpacing:"0.2em",
            textTransform:"uppercase", cursor: loading ? "not-allowed" : "pointer",
            opacity: loading || !nameInput.trim() ? 0.5 : 1, transition:"opacity 0.2s"
          }}
        >
          {loading ? "Conectando..." : "Entrar na sala →"}
        </button>
      </div>
    </div>
  );

  // ── CHAT ───────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex", flexDirection:"column", height:"100vh", background:s.bg, fontFamily:"'IBM Plex Sans',sans-serif", overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: none; }
        @keyframes blink { 50%{opacity:0;} }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #2e2e3a; }
      `}</style>

      {/* Topbar */}
      <div style={{
        background:s.panel, borderBottom:`1px solid ${s.border}`,
        padding:"0 20px", height:52, display:"flex", alignItems:"center",
        justifyContent:"space-between", flexShrink:0
      }}>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <span style={{fontFamily:"'Share Tech Mono',monospace", fontSize:13, letterSpacing:"0.15em", color:s.accent}}>CHAT</span>
          <div style={{display:"flex", alignItems:"center", gap:6, fontSize:12, color:s.dim}}>
            <div style={{
              width:6, height:6, borderRadius:"50%",
              background: online ? s.green : s.red,
              animation: online ? "blink 2s step-end infinite" : "none"
            }}/>
            <span>{online ? "Ao vivo" : "Reconectando..."}</span>
          </div>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:14}}>
          <div style={{display:"flex", alignItems:"center", gap:8, fontSize:13, color:s.dim}}>
            <div style={{
              width:28, height:28, borderRadius:"50%", background:hc(myName),
              display:"flex", alignItems:"center", justifyContent:"center",
              fontFamily:"'Share Tech Mono',monospace", fontSize:11, fontWeight:"bold", color:"#fff"
            }}>{ini(myName)}</div>
            <span>{myName}</span>
          </div>
          <button onClick={exitChat} style={{
            background:"transparent", border:`1px solid ${s.border2}`, padding:"5px 14px",
            color:s.dim, fontFamily:"'Share Tech Mono',monospace", fontSize:10,
            letterSpacing:"0.15em", textTransform:"uppercase", cursor:"pointer"
          }}>Sair</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{flex:1, overflowY:"auto", padding:20, display:"flex", flexDirection:"column", gap:2}}>
        {messages.length === 0 ? (
          <div style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:s.dimmer, gap:12, fontFamily:"'Share Tech Mono',monospace", fontSize:11, letterSpacing:"0.15em", textTransform:"uppercase"}}>
            <div style={{fontSize:32, opacity:0.3}}>💬</div>
            <div>Nenhuma mensagem ainda</div>
            <div style={{opacity:0.5}}>Seja o primeiro a falar</div>
          </div>
        ) : renderMessages()}
        <div ref={messagesEndRef}/>
      </div>

      {/* Typing */}
      <div style={{
        padding:"4px 20px", fontFamily:"'Share Tech Mono',monospace", fontSize:10,
        color:s.dimmer, letterSpacing:"0.1em", minHeight:22,
        background:s.panel, borderTop:`1px solid ${s.border}`, flexShrink:0
      }}>
        {typingNames.length > 0 && `${typingNames.join(', ')} ${typingNames.length===1?'está':'estão'} digitando...`}
      </div>

      {/* Input */}
      <div style={{
        background:s.panel, borderTop:`1px solid ${s.border}`,
        padding:"14px 20px", display:"flex", alignItems:"center", gap:12, flexShrink:0
      }}>
        <div style={{
          flex:1, background:s.bg2, border:`1px solid ${msgInput ? s.accentDim : s.border}`,
          display:"flex", alignItems:"center", transition:"border-color 0.2s"
        }}>
          <input
            value={msgInput}
            onChange={handleTyping}
            onKeyDown={handleInputKey}
            placeholder="Digite uma mensagem..."
            maxLength={400}
            autoComplete="off"
            style={{
              flex:1, background:"transparent", border:"none", padding:"11px 16px",
              color:s.text, fontFamily:"'IBM Plex Sans',sans-serif", fontSize:14
            }}
          />
          <span style={{padding:"0 12px", fontFamily:"'Share Tech Mono',monospace", fontSize:10, color:s.dimmer}}>
            {400 - msgInput.length}
          </span>
        </div>
        <button
          onClick={sendMsg}
          disabled={!msgInput.trim()}
          style={{
            background:s.accent, border:"none", padding:"12px 22px", color:"#fff",
            fontFamily:"'Share Tech Mono',monospace", fontSize:11, letterSpacing:"0.15em",
            textTransform:"uppercase", cursor: msgInput.trim() ? "pointer" : "not-allowed",
            opacity: msgInput.trim() ? 1 : 0.3, flexShrink:0, transition:"opacity 0.2s"
          }}
        >Enviar</button>
      </div>
    </div>
  );
}
