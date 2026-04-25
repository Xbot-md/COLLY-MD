import express from 'express';
import { createServer } from 'http';
import config from '../config.js';
import { submitPhoneNumber, getState } from './pairingState.js';

const app = express();
const server = createServer(app);
const PORT = config.port || 5000;

app.use(express.json());

app.get('/status', (_req: any, res: any) => {
    res.json(getState());
});

app.post('/pair', (req: any, res: any) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length < 7) return res.status(400).json({ error: 'Invalid phone number' });
    const ok = submitPhoneNumber(clean);
    if (!ok) return res.status(409).json({ error: 'Not ready for pairing. Current status: ' + getState().status });
    res.json({ success: true, message: 'Generating pairing code...' });
});

app.get('/health', (_req: any, res: any) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        memory: {
            rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB'
        },
        version: config.version,
        bot: config.botName
    });
});

app.get('/', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>COLLY MD — Bot Panel</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&family=Inter:wght@300;400;600&display=swap');

  *{margin:0;padding:0;box-sizing:border-box;}

  :root{
    --green:#00ff88;
    --green2:#25d366;
    --dark:#070d0a;
    --card:rgba(0,20,12,0.85);
    --border:rgba(0,255,136,0.25);
    --glow:0 0 20px rgba(0,255,136,0.4),0 0 60px rgba(0,255,136,0.15);
    --glow-strong:0 0 30px rgba(0,255,136,0.7),0 0 80px rgba(0,255,136,0.3);
  }

  html,body{
    min-height:100vh;
    background:var(--dark);
    color:#e0ffe8;
    font-family:'Inter',sans-serif;
    overflow-x:hidden;
  }

  /* Matrix canvas */
  #matrix-bg{
    position:fixed;top:0;left:0;width:100%;height:100%;
    z-index:0;opacity:0.18;pointer-events:none;
  }

  /* Radial glow */
  body::before{
    content:'';
    position:fixed;top:50%;left:50%;
    transform:translate(-50%,-50%);
    width:70vw;height:70vw;
    background:radial-gradient(ellipse,rgba(0,255,136,0.08) 0%,transparent 70%);
    pointer-events:none;z-index:0;
    animation:pulseGlow 4s ease-in-out infinite;
  }
  @keyframes pulseGlow{
    0%,100%{opacity:0.6}50%{opacity:1}
  }

  .page{
    position:relative;z-index:1;
    min-height:100vh;
    display:flex;flex-direction:column;
    align-items:center;justify-content:center;
    padding:24px 16px;
  }

  /* Header */
  .logo-wrap{text-align:center;margin-bottom:36px;}
  .logo-icon{
    font-size:3.5rem;
    display:block;
    filter:drop-shadow(0 0 20px #00ff88);
    animation:iconFloat 3s ease-in-out infinite;
    margin-bottom:10px;
  }
  @keyframes iconFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}

  .logo-title{
    font-family:'Orbitron',monospace;
    font-size:clamp(1.8rem,6vw,3.2rem);
    font-weight:900;
    letter-spacing:6px;
    background:linear-gradient(135deg,#00ff88,#25d366,#00c4ff);
    -webkit-background-clip:text;
    -webkit-text-fill-color:transparent;
    background-clip:text;
    text-shadow:none;
    filter:drop-shadow(0 0 18px rgba(0,255,136,0.6));
    animation:titlePulse 2.5s ease-in-out infinite;
  }
  @keyframes titlePulse{0%,100%{filter:drop-shadow(0 0 18px rgba(0,255,136,0.6))}50%{filter:drop-shadow(0 0 32px rgba(0,255,136,0.9))}}

  .logo-sub{
    font-family:'Share Tech Mono',monospace;
    color:rgba(0,255,136,0.55);
    font-size:0.78rem;
    letter-spacing:4px;
    text-transform:uppercase;
    margin-top:6px;
  }

  /* Card */
  .card{
    background:var(--card);
    border:1px solid var(--border);
    border-radius:20px;
    padding:36px 32px;
    width:100%;max-width:440px;
    box-shadow:var(--glow),inset 0 1px 0 rgba(255,255,255,0.05);
    backdrop-filter:blur(20px);
    position:relative;
    overflow:hidden;
  }
  .card::before{
    content:'';
    position:absolute;top:0;left:-100%;width:200%;height:2px;
    background:linear-gradient(90deg,transparent,#00ff88,transparent);
    animation:scanLine 3s linear infinite;
  }
  @keyframes scanLine{0%{left:-100%}100%{left:100%}}

  /* Status bar */
  .status-bar{
    display:flex;align-items:center;gap:10px;
    margin-bottom:28px;
    padding:8px 14px;
    background:rgba(0,0,0,0.3);
    border-radius:50px;
    border:1px solid rgba(0,255,136,0.15);
    font-family:'Share Tech Mono',monospace;
    font-size:0.78rem;
    letter-spacing:1px;
  }
  .status-dot{
    width:9px;height:9px;border-radius:50%;
    background:var(--green);
    box-shadow:0 0 8px var(--green);
    flex-shrink:0;
  }
  .status-dot.orange{background:#ffaa00;box-shadow:0 0 8px #ffaa00;}
  .status-dot.blue{background:#00aaff;box-shadow:0 0 8px #00aaff;}
  .status-dot.red{background:#ff4444;box-shadow:0 0 8px #ff4444;}
  .status-dot.pulse{animation:dotPulse 1s ease-in-out infinite;}
  @keyframes dotPulse{0%,100%{opacity:1}50%{opacity:0.2}}
  .status-text{color:rgba(0,255,136,0.8);}

  /* Step panels */
  .panel{display:none;animation:fadeIn 0.4s ease;}
  .panel.active{display:block;}
  @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

  /* Input */
  .input-group{margin-bottom:20px;position:relative;}
  .input-label{
    font-size:0.72rem;letter-spacing:2px;text-transform:uppercase;
    color:rgba(0,255,136,0.6);margin-bottom:8px;display:block;
    font-family:'Share Tech Mono',monospace;
  }
  .input-field{
    width:100%;padding:14px 18px;
    background:rgba(0,0,0,0.4);
    border:1px solid rgba(0,255,136,0.3);
    border-radius:12px;
    color:#e0ffe8;
    font-family:'Share Tech Mono',monospace;
    font-size:1rem;
    outline:none;
    transition:all 0.3s;
    letter-spacing:1px;
  }
  .input-field:focus{
    border-color:var(--green);
    box-shadow:0 0 0 3px rgba(0,255,136,0.12),0 0 20px rgba(0,255,136,0.15);
    background:rgba(0,20,12,0.6);
  }
  .input-field::placeholder{color:rgba(0,255,136,0.25);}

  /* Button */
  .btn{
    width:100%;padding:15px;
    background:linear-gradient(135deg,#00c853,#00ff88);
    color:#001a0d;
    font-family:'Orbitron',monospace;
    font-weight:700;
    font-size:0.85rem;
    letter-spacing:3px;
    border:none;border-radius:12px;
    cursor:pointer;
    transition:all 0.3s;
    text-transform:uppercase;
    position:relative;overflow:hidden;
  }
  .btn::before{
    content:'';position:absolute;top:0;left:-100%;
    width:100%;height:100%;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,0.25),transparent);
    transition:left 0.4s;
  }
  .btn:hover::before{left:100%;}
  .btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,255,136,0.4);}
  .btn:active{transform:translateY(0);}
  .btn:disabled{opacity:0.5;cursor:not-allowed;transform:none;}

  .btn-outline{
    background:transparent;
    border:1px solid rgba(0,255,136,0.4);
    color:var(--green);
    margin-top:12px;
  }
  .btn-outline:hover{background:rgba(0,255,136,0.08);box-shadow:0 0 16px rgba(0,255,136,0.2);}

  /* Hint */
  .hint{
    font-size:0.75rem;color:rgba(0,255,136,0.4);
    margin-top:10px;text-align:center;
    font-family:'Share Tech Mono',monospace;
    letter-spacing:0.5px;
    line-height:1.5;
  }

  /* Generating spinner */
  .spinner-wrap{text-align:center;padding:20px 0;}
  .spinner{
    width:56px;height:56px;margin:0 auto 20px;
    border:3px solid rgba(0,255,136,0.15);
    border-top-color:var(--green);
    border-radius:50%;
    animation:spin 0.8s linear infinite;
    box-shadow:0 0 20px rgba(0,255,136,0.3);
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner-text{
    font-family:'Share Tech Mono',monospace;
    color:rgba(0,255,136,0.7);
    font-size:0.85rem;letter-spacing:2px;
    animation:blink 1.5s ease-in-out infinite;
  }
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}

  /* Pairing code */
  .code-label{
    font-family:'Share Tech Mono',monospace;
    font-size:0.7rem;letter-spacing:3px;
    color:rgba(0,255,136,0.5);
    text-align:center;
    text-transform:uppercase;
    margin-bottom:16px;
  }
  .code-grid{
    display:flex;gap:8px;justify-content:center;
    margin-bottom:20px;
    flex-wrap:wrap;
  }
  .code-chunk{
    background:rgba(0,0,0,0.5);
    border:1px solid rgba(0,255,136,0.4);
    border-radius:10px;
    padding:14px 16px;
    font-family:'Orbitron',monospace;
    font-size:1.5rem;
    font-weight:700;
    letter-spacing:4px;
    color:var(--green);
    text-shadow:0 0 12px var(--green);
    box-shadow:inset 0 0 12px rgba(0,255,136,0.05),0 0 12px rgba(0,255,136,0.2);
    min-width:80px;text-align:center;
    animation:codeGlow 2s ease-in-out infinite;
  }
  @keyframes codeGlow{0%,100%{box-shadow:inset 0 0 12px rgba(0,255,136,0.05),0 0 12px rgba(0,255,136,0.2)}50%{box-shadow:inset 0 0 20px rgba(0,255,136,0.1),0 0 24px rgba(0,255,136,0.4)}}
  .code-dash{
    align-self:center;
    color:rgba(0,255,136,0.3);
    font-size:1.5rem;
    font-family:'Orbitron',monospace;
  }

  .copy-btn{
    display:flex;align-items:center;justify-content:center;gap:8px;
    width:100%;padding:11px;
    background:rgba(0,255,136,0.08);
    border:1px solid rgba(0,255,136,0.25);
    border-radius:10px;
    color:var(--green);cursor:pointer;
    font-family:'Share Tech Mono',monospace;
    font-size:0.82rem;letter-spacing:1px;
    transition:all 0.3s;margin-bottom:16px;
  }
  .copy-btn:hover{background:rgba(0,255,136,0.15);border-color:var(--green);}
  .copy-btn.copied{background:rgba(0,255,136,0.2);border-color:var(--green);color:#00ff88;}

  .steps{
    margin-top:16px;
    background:rgba(0,0,0,0.25);
    border-radius:12px;
    padding:14px 16px;
    border:1px solid rgba(0,255,136,0.1);
  }
  .step-item{
    font-size:0.76rem;color:rgba(0,255,136,0.6);
    padding:4px 0;
    font-family:'Share Tech Mono',monospace;
    display:flex;gap:8px;align-items:flex-start;
    line-height:1.5;
  }
  .step-num{color:var(--green);font-weight:bold;flex-shrink:0;}

  /* Connected */
  .connected-icon{
    font-size:4rem;text-align:center;
    display:block;
    filter:drop-shadow(0 0 20px #00ff88);
    animation:connectedBounce 0.6s ease;
    margin-bottom:16px;
  }
  @keyframes connectedBounce{0%{transform:scale(0)}60%{transform:scale(1.2)}100%{transform:scale(1)}}
  .connected-title{
    font-family:'Orbitron',monospace;
    font-size:1.1rem;font-weight:700;
    text-align:center;color:var(--green);
    letter-spacing:3px;margin-bottom:8px;
    text-shadow:0 0 16px var(--green);
  }
  .connected-sub{
    text-align:center;
    font-family:'Share Tech Mono',monospace;
    font-size:0.78rem;
    color:rgba(0,255,136,0.5);
    letter-spacing:1px;
  }

  /* Error */
  .error-msg{
    background:rgba(255,68,68,0.1);
    border:1px solid rgba(255,68,68,0.3);
    border-radius:10px;padding:10px 14px;
    font-size:0.78rem;color:#ff8888;
    font-family:'Share Tech Mono',monospace;
    margin-top:12px;display:none;
    animation:fadeIn 0.3s ease;
  }

  /* Footer */
  .footer{
    margin-top:28px;text-align:center;
    font-family:'Share Tech Mono',monospace;
    font-size:0.68rem;letter-spacing:2px;
    color:rgba(0,255,136,0.2);
  }
  .footer span{color:rgba(0,255,136,0.4);}

  /* Divider */
  .divider{
    height:1px;background:linear-gradient(90deg,transparent,rgba(0,255,136,0.2),transparent);
    margin:20px 0;
  }

  /* Responsive */
  @media(max-width:480px){
    .card{padding:24px 18px;}
    .code-chunk{padding:10px 12px;font-size:1.2rem;min-width:64px;}
  }
</style>
</head>
<body>
<canvas id="matrix-bg"></canvas>

<div class="page">
  <div class="logo-wrap">
    <span class="logo-icon">🤖</span>
    <div class="logo-title">COLLY MD</div>
    <div class="logo-sub">WhatsApp Bot Panel &nbsp;•&nbsp; v${config.version}</div>
  </div>

  <div class="card">
    <div class="status-bar">
      <span class="status-dot pulse" id="statusDot"></span>
      <span class="status-text" id="statusText">INITIALIZING...</span>
    </div>

    <!-- Step 1: Enter number -->
    <div class="panel" id="panelNumber">
      <div class="input-group">
        <label class="input-label">📱 WhatsApp Number</label>
        <input
          class="input-field"
          id="phoneInput"
          type="tel"
          placeholder="2349133354644"
          maxlength="20"
          autocomplete="off"
        />
      </div>
      <div class="hint">Include country code · No + or spaces<br/>Example: 2349133354644</div>
      <div class="divider"></div>
      <button class="btn" id="pairBtn" onclick="submitNumber()">⚡ GENERATE PAIRING CODE</button>
      <div class="error-msg" id="errorMsg"></div>
    </div>

    <!-- Step 2: Generating -->
    <div class="panel" id="panelGenerating">
      <div class="spinner-wrap">
        <div class="spinner"></div>
        <div class="spinner-text">GENERATING CODE...</div>
      </div>
    </div>

    <!-- Step 3: Code ready -->
    <div class="panel" id="panelCode">
      <div class="code-label">🔐 Your Pairing Code</div>
      <div class="code-grid" id="codeGrid"></div>
      <button class="copy-btn" id="copyBtn" onclick="copyCode()">
        <span>📋</span><span id="copyText">Copy Code</span>
      </button>
      <div class="steps">
        <div class="step-item"><span class="step-num">1.</span><span>Open WhatsApp on your phone</span></div>
        <div class="step-item"><span class="step-num">2.</span><span>Go to Settings → Linked Devices</span></div>
        <div class="step-item"><span class="step-num">3.</span><span>Tap "Link a Device" → "Link with phone number"</span></div>
        <div class="step-item"><span class="step-num">4.</span><span>Enter the code shown above</span></div>
      </div>
      <button class="btn btn-outline" onclick="resetPanel()">↩ Use Different Number</button>
    </div>

    <!-- Step 4: Connected -->
    <div class="panel" id="panelConnected">
      <span class="connected-icon">✅</span>
      <div class="connected-title">BOT CONNECTED</div>
      <div class="connected-sub" id="connectedSub">COLLY MD is online and ready</div>
      <div class="divider"></div>
      <div class="steps">
        <div class="step-item"><span class="step-num">✓</span><span>Bot is running in background</span></div>
        <div class="step-item"><span class="step-num">✓</span><span>Send <strong style="color:#00ff88">. menu</strong> in WhatsApp to see all commands</span></div>
        <div class="step-item"><span class="step-num">✓</span><span>Owner: <strong style="color:#00ff88">${config.botOwner}</strong></span></div>
      </div>
    </div>

    <!-- Step 5: Already running -->
    <div class="panel" id="panelIdle">
      <div class="spinner-wrap">
        <div class="spinner-text" style="font-size:0.9rem">STARTING UP...</div>
      </div>
    </div>

  </div>

  <div class="footer">
    POWERED BY <span>DAVIDXTECH</span> &nbsp;•&nbsp; OWNER: <span>COLLY NOVELS</span>
  </div>
</div>

<script>
// ─── Matrix rain ───────────────────────────────────────────────
const canvas = document.getElementById('matrix-bg');
const ctx = canvas.getContext('2d');
let cols, drops;
function initMatrix(){
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  cols = Math.floor(canvas.width / 20);
  drops = Array(cols).fill(1);
}
function drawMatrix(){
  ctx.fillStyle = 'rgba(7,13,10,0.06)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#00ff88';
  ctx.font = '14px Share Tech Mono, monospace';
  const chars = 'COLLYMD01アイウエオカキクケコサシスセソタチツテトナニヌネノ';
  drops.forEach((y,i)=>{
    const ch = chars[Math.floor(Math.random()*chars.length)];
    ctx.globalAlpha = Math.random() * 0.6 + 0.1;
    ctx.fillText(ch, i*20, y*20);
    ctx.globalAlpha = 1;
    if(y*20 > canvas.height && Math.random() > 0.975) drops[i] = 0;
    drops[i]++;
  });
}
initMatrix();
window.addEventListener('resize', initMatrix);
setInterval(drawMatrix, 50);

// ─── State machine ─────────────────────────────────────────────
let currentCode = '';
let currentStatus = '';

function showPanel(id){
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setDot(type){
  const dot = document.getElementById('statusDot');
  dot.className = 'status-dot pulse';
  if(type==='green') dot.style.cssText='';
  else if(type==='orange'){dot.classList.add('orange');}
  else if(type==='blue'){dot.classList.add('blue');}
  else if(type==='red'){dot.classList.add('red');}
}

function applyState(s){
  if(s.status === currentStatus) return;
  currentStatus = s.status;

  const statusText = document.getElementById('statusText');
  const btn = document.getElementById('pairBtn');

  if(s.status === 'waiting_number'){
    setDot('green');
    statusText.textContent = 'READY — ENTER NUMBER';
    btn.disabled = false;
    btn.textContent = '⚡ GENERATE PAIRING CODE';
    document.getElementById('errorMsg').style.display = 'none';
    showPanel('panelNumber');
  } else if(s.status === 'generating'){
    setDot('orange');
    statusText.textContent = 'GENERATING CODE...';
    showPanel('panelGenerating');
  } else if(s.status === 'code_ready'){
    setDot('blue');
    statusText.textContent = 'CODE READY — CHECK WHATSAPP';
    currentCode = s.pairingCode || '';
    renderCode(currentCode);
    showPanel('panelCode');
  } else if(s.status === 'connected'){
    setDot('green');
    statusText.textContent = 'ONLINE — BOT CONNECTED ✓';
    if(s.connectedNumber){
      document.getElementById('connectedSub').textContent = 'Connected as ' + s.connectedNumber;
    }
    showPanel('panelConnected');
  } else if(s.status === 'error'){
    setDot('red');
    statusText.textContent = 'INVALID NUMBER — TRY AGAIN';
    btn.disabled = false;
    btn.textContent = '⚡ GENERATE PAIRING CODE';
    showPanel('panelNumber');
    showError(s.errorMessage || 'An error occurred. Please try again.');
  } else {
    setDot('orange');
    statusText.textContent = 'STARTING...';
    showPanel('panelIdle');
  }
}

function renderCode(code){
  const grid = document.getElementById('codeGrid');
  grid.innerHTML = '';
  const parts = code.split('-');
  parts.forEach((part, i) => {
    const chunk = document.createElement('div');
    chunk.className = 'code-chunk';
    chunk.textContent = part;
    grid.appendChild(chunk);
    if(i < parts.length - 1){
      const dash = document.createElement('div');
      dash.className = 'code-dash';
      dash.textContent = '–';
      grid.appendChild(dash);
    }
  });
}

async function submitNumber(){
  const phone = document.getElementById('phoneInput').value.replace(/\\D/g,'');
  const btn = document.getElementById('pairBtn');
  const err = document.getElementById('errorMsg');
  err.style.display = 'none';

  if(phone.length < 7){
    showError('Please enter a valid phone number with country code.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'SENDING...';

  try {
    const r = await fetch('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});
    const d = await r.json();
    if(!r.ok){ showError(d.error||'Failed'); btn.disabled=false; btn.textContent='⚡ GENERATE PAIRING CODE'; return; }
    currentStatus = '';
  } catch(e){
    showError('Network error. Please try again.');
    btn.disabled = false;
    btn.textContent = '⚡ GENERATE PAIRING CODE';
  }
}

function showError(msg){
  const el = document.getElementById('errorMsg');
  el.textContent = '⚠ ' + msg;
  el.style.display = 'block';
}

function resetPanel(){
  const btn = document.getElementById('pairBtn');
  btn.disabled = false;
  btn.textContent = '⚡ GENERATE PAIRING CODE';
  document.getElementById('phoneInput').value = '';
  document.getElementById('errorMsg').style.display = 'none';
  currentStatus = '';
}

async function copyCode(){
  const btn = document.getElementById('copyBtn');
  const txt = document.getElementById('copyText');
  try {
    await navigator.clipboard.writeText(currentCode.replace(/-/g,''));
    btn.classList.add('copied');
    txt.textContent = 'Copied!';
    setTimeout(()=>{ btn.classList.remove('copied'); txt.textContent = 'Copy Code'; }, 2000);
  } catch(e){
    txt.textContent = currentCode;
    setTimeout(()=>{ txt.textContent = 'Copy Code'; }, 3000);
  }
}

// Enter key submits
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('phoneInput').addEventListener('keydown', e => {
    if(e.key === 'Enter') submitNumber();
  });
});

// ─── Poll status ───────────────────────────────────────────────
async function pollStatus(){
  try {
    const r = await fetch('/status');
    const s = await r.json();
    applyState(s);
  } catch(e){}
}
pollStatus();
setInterval(pollStatus, 1500);
</script>
</body>
</html>`);
});

export { app, server, PORT };
