// ====== Geometry / config ======
  const DEG = Math.PI / 180;
  const START_DEG = -60; // relative to vertical (top)
  const END_DEG   =  60;
  const SWEEP = END_DEG - START_DEG; // 120° sweep
  const CENTER = { x: 270, y: 255 };
  const R = 220;   // base radius for outermost scale

  // Stacked linear scale labels
  const LINEAR_LABEL_SETS = [10, 50, 250];

  // Mode ranges
  const RANGES = {
    dcv: LINEAR_LABEL_SETS,     // Volts
    dca: [5, 50, 500],     // milliamp ranges tied to same scales
    ohms: ["×1", "×10", "×100", "×1000"]
  };

  // Mid‑scale ohms K values for Ω mapping (f = 1/(1 + R/K))
  const OHMS_K = { "×1": 20, "×10": 200, "×100": 2000, "×1000": 20000 };
  const OHMS_MULT = {"×1": 1, "×10": 10, "×100": 100, "×1000": 1000}

  let OHM_TICKS = [];

  // ====== State ======
  const state = { mode: 'dcv', range: 10, trueValue: 0, rounds: 0, correct: 0, streak: 0 };

  // ====== DOM ======
  const app = document.getElementById('app');
  const scaleG = document.getElementById('scale');
  const needle = document.getElementById('needle');
  const title = document.getElementById('title');
  const modeSel = document.getElementById('mode');
  const rangeSel = document.getElementById('range');
  // const tol = document.getElementById('tol');
  // const tolVal = document.getElementById('tolVal');
  const guess = document.getElementById('guess');
  const feedback = document.getElementById('feedback');
  const statRounds = document.getElementById('stat-rounds');
  const statCorrect = document.getElementById('stat-correct');
  const statStreak = document.getElementById('stat-streak');

  // ====== Utilities ======
  function clamp(x,min,max){ return Math.max(min, Math.min(max, x)); }
  function toRad(deg){ return deg * DEG; }
  function fractionToTopDeg(f){ return START_DEG + f*SWEEP; } // 0° = vertical up
  function topDegToCanvasDeg(d){ return d - 90; } // convert to canvas math (0° = +x)

  function fmtValue(v, u){
    if (u === 'Ω'){
      const abs = Math.abs(v);
      if (abs >= 1e6) return (v/1e6).toFixed(2) + 'MΩ';
      if (abs >= 1e3) return (v/1e3).toFixed(2) + 'kΩ';
      return v.toFixed(2) + 'Ω';
    } else if (u === 'A'){
      const abs = Math.abs(v);
      if (abs < 1e-3) return (v*1e6).toFixed(2) + 'µA';
      if (abs < 1)   return (v*1e3).toFixed(3) + 'mA';
      return v.toFixed(3) + 'A';
    } else { // V
      const abs = Math.abs(v);
      if (abs < 1) return v.toFixed(3) + 'V';
      if (abs < 10) return v.toFixed(2) + 'V';
      return v.toFixed(1) + 'V';
    }
  }

  function parseReading(text){
    if (!text) return NaN;
    let s = text.trim().replace(/\s+/g,'').replace(/µ/g,'u');
    const m = s.match(/^([+-]?[0-9]*\.?[0-9]+)([a-zA-Z]*)$/);
    if (!m) return NaN;
    let val = parseFloat(m[1]);
    const suf = (m[2]||'');
    const mul = suf === 'G' ? 1e9
              : suf === 'M' ? 1e6
              : suf === 'k' ? 1e3
              : suf === 'm' ? 1e-3
              : suf === 'u' ? 1e-6
              : suf === 'GA' ? 1e9
              : suf === 'MA' ? 1e6
              : suf === 'kA' ? 1e3
              : suf === 'A' ? 1
              : suf === 'mA' ? 1e-3
              : suf === 'uA' ? 1e-6
              : suf === 'GV' ? 1e9
              : suf === 'MV' ? 1e6
              : suf === 'kV' ? 1e3
              : suf === 'V' ? 1
              : suf === 'mV' ? 1e-3
              : suf === 'uV' ? 1e-6
              : suf === 'Gohm' || suf === 'Go' || suf === 'GΩ' ? 1e9
              : suf === 'Mohm' || suf === 'Mo' || suf === 'MΩ'  ? 1e6
              : suf === 'kohm' || suf === 'ko' || suf === 'kΩ'  ? 1e3
              : suf === 'ohm' || suf === 'o' || suf === 'Ω' ? 1
              : suf === 'mohm' || suf === 'mo' || suf === 'mΩ' ? 1e-3
              : suf === 'uohm'  || suf === 'uo' || suf === 'uΩ' ? 1e-6
              : suf === '' ? 1 : 1;
    return val * mul;
  }

  // ====== Drawing helpers ======
  function clearScale(){ scaleG.innerHTML = ''; }

  function polar(cx, cy, r, degCanvas){
    const a = toRad(degCanvas);
    return { x: cx + r*Math.cos(a), y: cy + r*Math.sin(a) };
  }

  function drawArc(r, stroke, width, opacity=1){
    const start = polar(CENTER.x, CENTER.y, r, topDegToCanvasDeg(END_DEG));
    const end   = polar(CENTER.x, CENTER.y, r, topDegToCanvasDeg(START_DEG));
    const largeArc = (END_DEG - START_DEG) <= 180 ? 0 : 1;
    const d = [
      'M', start.x, start.y,
      'A', r, r, 0, largeArc, 0, end.x, end.y
    ].join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', d);
    path.setAttribute('fill','none');
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', width);
    path.setAttribute('opacity', opacity);
    scaleG.appendChild(path);
  }

  function drawTickAt(baseR, degCanvas, len, width, color, interior=true){
    const x1 = CENTER.x + (baseR) * Math.cos(toRad(degCanvas));
    const y1 = CENTER.y + (baseR) * Math.sin(toRad(degCanvas));
    const x2 = CENTER.x + (interior ? (baseR - len) : (baseR + len)) * Math.cos(toRad(degCanvas));
    const y2 = CENTER.y + (interior ? (baseR - len) : (baseR + len)) * Math.sin(toRad(degCanvas));
    const tick = document.createElementNS('http://www.w3.org/2000/svg','line');
    tick.setAttribute('x1', x1); tick.setAttribute('y1', y1);
    tick.setAttribute('x2', x2); tick.setAttribute('y2', y2);
    tick.setAttribute('stroke', color); tick.setAttribute('stroke-width', width);
    scaleG.appendChild(tick);
  }

  function drawLabel(degCanvas, radius, text, color='#000000', size=12){
    const p = polar(CENTER.x, CENTER.y, radius, degCanvas);
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.textContent = text;
    t.setAttribute('x', p.x); t.setAttribute('y', p.y + 4);
    t.setAttribute('font-size', String(size));
    t.setAttribute('text-anchor','middle');
    t.setAttribute('fill', color);
    scaleG.appendChild(t);
  }

  // ====== Scale builder: multiscale face ======
  function buildMultiscaleFace(){
    clearScale();

    // Outer arc backdrop
    drawArc(R, '#3a4579', 8, .65);

    // ===== Linear tick grid =====
    const maxRange = 250;
    const baseLinear = R - 6; // inside ring radius
    for (let v = 0; v <= maxRange; v += 5){ // minors every 5, mids at 10s, majors at 50s
      const f = v / maxRange;
      const degTop = fractionToTopDeg(f);
      const degCanvas = topDegToCanvasDeg(degTop);
      const major = (v % 50 === 0);
      const mid   = (!major && v % 25 === 0);
      if (major)      drawTickAt(baseLinear, degCanvas, 18, 2.3, '#000000');
      else if (mid)   drawTickAt(baseLinear, degCanvas, 12, 1.8, '#000000');
      else            drawTickAt(baseLinear, degCanvas,  7, 1.2, '#000000');
    }

    // Stacked labels for 0–10, 0–50, 0–250
    const labelRadii = [R-68, R-50, R-34];
    const ranges = [10, 50, 250];
    ranges.forEach((range, idx) =>{
      const rr = labelRadii[idx];
      const step = range === 10 ? 2 : (range === 50 ? 10 : 50);
      for (let v = 0; v <= range; v += step){
        const f = v / range;
        const degCanvas = topDegToCanvasDeg(fractionToTopDeg(f));
        drawLabel(degCanvas, rr, String(v));
      }
    });

    // ===== Ohms scale with custom subdivisions =====
    const baseOhm = R + 5;   // outer ring for ticks
    const ohmLabelR = R + 32; // label radius
    const K = OHMS_K['×1'];

    const ohmMajors = [Infinity, 2000, 1000, 500, 200, 100, 50, 30, 20, 10, 5, 2, 1, 0];
    const ohmLabelSet = new Set([0,1,2,5,10,20,30,50,100,200,500,1000,2000]);

    function ohmDegCanvas(val){
      if (val === Infinity) return topDegToCanvasDeg(fractionToTopDeg(0));
      if (val <= 0) return topDegToCanvasDeg(fractionToTopDeg(1));
      const f = 1/(1 + val/K); // non-linear map
      return topDegToCanvasDeg(fractionToTopDeg(f));
    }

    function drawOhmTick(val, len, width){
      OHM_TICKS.push(val);
      const deg = ohmDegCanvas(val);
      drawTickAt(baseOhm, deg, len, width, 'var(--ohm)', false);
    }

    // Draw major ticks + labels
    ohmMajors.forEach(v =>{
      const isEdge = (v === Infinity || v === 0);
      const len = isEdge ? 18 : 18;
      drawOhmTick(v, len, 2.4);
      if (v !== Infinity && ohmLabelSet.has(v)){
        const lbl = v >= 1000 ? (v/1000)+'k' : String(v);
        drawLabel(ohmDegCanvas(v == 1000 ? v - 300 : v > 1000 ? v + 300 : v), v >= 1000 ? ohmLabelR + 24 : ohmLabelR, lbl, 'var(--ohm)');
      }
      if (v === Infinity){
        drawLabel(ohmDegCanvas(v), ohmLabelR, '∞', 'var(--ohm)');
      }
    });

    // ---- Subdivisions ----
    // 0–2 : fifths
    (function(){
      const a=0, b=1; const step=1/5; // 0.2
      for (let t=a+step; t<b; t+=step){ drawOhmTick(t, 8, 1.2); }
    })();

    (function(){
      const a=1, b=2; const step=1/5; // 0.2
      for (let t=a+step; t<b; t+=step){ drawOhmTick(t, 8, 1.2); }
    })();

    // 2–10 : halves and wholes (unlabeled)
    (function(){
      for (let v=3; v<5; v++) drawOhmTick(v, 11, 1.6); // wholes
      for (let v=2.5; v<5; v+=1) drawOhmTick(v, 8, 1.2); // halves
    })();

    (function(){
      for (let v=6; v<10; v++) drawOhmTick(v, 11, 1.6); // wholes
      for (let v=5.5; v<10; v+=1) drawOhmTick(v, 8, 1.2); // halves
    })();

    // 10–15 : fifths (i.e., 11,12,13,14)
    (function(){ for (let v=11; v<15; v++) drawOhmTick(v, 10, 1.2); })();

    drawOhmTick(15, 13, 1.6);

    // 15–20 : fifths (16–19)
    (function(){ for (let v=16; v<20; v++) drawOhmTick(v, 10, 1.2); })();

    // 20–50 : fifths
    (function(){ [22,24,26,28,32,34,36,38,42,44,46,48].forEach(v=> drawOhmTick(v, 10, 1.2)); })();

    drawOhmTick(40, 13, 1.6);

    // 50–100 : halves and wholes
    (function(){
      [60,70,80,90].forEach(v=> drawOhmTick(v, 11, 1.6)); // wholes (10s)
      [55,65,75,85,95].forEach(v=> drawOhmTick(v, 8, 1.2)); // halves (5s)
    })();

    // 100–200 : fifths (120, 140, 160, 180)
    (function(){ [120,140,160,180,250].forEach(v=> drawOhmTick(v, 10, 1.2)); })();

    (function(){ [300,400].forEach(v=> drawOhmTick(v, 11, 1.6)); })();

    OHM_TICKS = OHM_TICKS.toSorted(function(a,b){
      if (a === Infinity && b === Infinity) {
        return 0;
      }
      else if (a === Infinity && b !== Infinity) {
        return 1
      }
      else if (a !== Infinity && b === Infinity) {
        return -1;
      }
      else if (a !== Infinity && b !== Infinity) {
        return a - b;
      }
    });
    // console.log(OHM_TICKS);
  }

  // ====== Needle / value mapping ======
  function setNeedleByFraction(f){
    f = clamp(f, 0, 1);
    const degTop = fractionToTopDeg(f);
    needle.style.transition = 'transform 420ms cubic-bezier(.2,.9,.2,1.05)';
    needle.setAttribute('transform', `rotate(${degTop}, ${CENTER.x}, ${CENTER.y})`);
  }

  function unitsForMode(){
    if (state.mode === 'ohms') return 'Ω';
    if (state.mode === 'dca') return 'A';
    return 'V';
  }

  function currentLinearRangeValue(){
    // Convert selected label to numeric in base units
    if (state.mode === 'dca'){
      const raw = state.range; // '10m', '50m', '250m'
      const n = typeof raw === 'string' ? parseFloat(raw) : raw;
      return (n) * 1e-3; // mA → A
    } else { return Number(state.range); }
  }

  function valueToFraction(v){
    if (state.mode === 'ohms'){
      const mult = state.range; // ×1/×10/×100/×1000
      const K = OHMS_K[mult];
      if (!isFinite(v)) return 0;
      return clamp(1/(1 + Math.max(0,v)/K), 0, 1);
    } else {
      const span = currentLinearRangeValue();
      return clamp(v / span, 0, 1);
    }
  }

  function fractionToValue(f){
    if (state.mode === 'ohms'){
      const K = OHMS_K[state.range];
      if (f <= 0) return Infinity;
      return K * (1/f - 1);
    } else { return f * currentLinearRangeValue(); }
  }

  // ====== Game logic ======
  function pickRandomTrueValue(){
    if (state.mode === 'ohms'){
      const f = Math.random() * 0.9 + 0.05; // avoid extremes
      let Rv = fractionToValue(f);
      if (!isFinite(Rv)) Rv = 2000; // cap
      return Math.max(0, Rv);
    } else {
      const span = currentLinearRangeValue();
      const f = Math.random() * 0.94 + 0.03;
      return f * span;
    }
  }

  function setRangeOptions(){
    state.mode = modeSel.value;
    rangeSel.innerHTML = '';
    const opts = RANGES[state.mode];
    opts.forEach(r =>{
      const opt = document.createElement('option');
      opt.value = r;
      if (state.mode === 'dca'){
        const n = typeof r === 'string' ? parseFloat(r) : r;
        opt.textContent = `${n} mA`;
      } else if (state.mode === 'ohms'){
        opt.textContent = r;
      } else { opt.textContent = `${r} V`; }
      rangeSel.appendChild(opt);
    });
    rangeSel.selectedIndex = 1; // default to 50-range
    state.range = opts[1];
  }

  function newRound(){
    document.getElementById('check').disabled = false;
    shuffleMode();
    state.trueValue = pickRandomTrueValue();
    setNeedleByFraction(valueToFraction(state.trueValue));
    feedback.textContent = '';
    guess.value = '';
    state.rounds += 1; updateStats();
  }

  function nearestOhmTick(value) {
    const val_mult = OHMS_MULT[state.range];
    let lower = OHM_TICKS[0];
    let upper = OHM_TICKS[OHM_TICKS.length-1];
    for (let i = 1; i < OHM_TICKS.length; i++) {
      if ((val_mult * OHM_TICKS[i]) <= value) {
        lower = OHM_TICKS[i];
      }

      if (value <= (val_mult * OHM_TICKS[OHM_TICKS.length-i])) {
        upper = OHM_TICKS[OHM_TICKS.length-i];
      }
    }
    return {'lowerTick': lower, 'upperTick': upper};
  }

  // scale tolerance by linear fraction then convert to value
  function fractionTolerance(value, tolerance){
    const u = unitsForMode();
    let fraction = valueToFraction(value);
    let upperLimitFraction = fraction - tolerance;
    let lowerLimitFraction = fraction + tolerance;
    let upperLimit = fractionToValue(upperLimitFraction);
    let lowerLimit = fractionToValue(lowerLimitFraction);
    nearestTicks = nearestOhmTick(value);
    console.log(`${fmtValue(lowerLimit,u)} < ${nearestTicks['lowerTick']} | ${fmtValue(value,u)} | ${nearestTicks['upperTick']} < ${fmtValue(upperLimit,u)}`);
    return upperLimit - lowerLimit;
  }

  function checkAnswer(){
    if (!document.getElementById('check').disabled) {
      const u = unitsForMode();
      let g = parseReading(guess.value);
      if (isNaN(g)){
        feedback.innerHTML = `<span class="no">Enter a number (use suffixes like k, m, µ if you want).</span>`; return;
      }
      // const tolPct = Number(tol.value);
      const target = state.trueValue;
      // const allowed = Math.max(0.001, (tolPct/100) * (state.mode==='ohms' ? Math.max(1, target) : currentLinearRangeValue()));
      const allowed = Math.max(0.00001, state.mode==='ohms' ? fractionTolerance(target, 0.005) : 0.015 * currentLinearRangeValue());
      console.log(allowed);
      const diff = Math.abs(g - target);
      const win = diff <= allowed;
      if (win){
        state.correct += 1; state.streak += 1; document.getElementById('check').disabled = true;
        feedback.innerHTML = `<span class="ok">✔ Correct! ${fmtValue(g,u)} within ±${fmtValue(allowed,u)} (Δ ${fmtValue(diff,u)}).<br/>True: <b>${fmtValue(target,u)}</b></span>`;
      } else {
        state.streak = 0;
        feedback.innerHTML = `<span class="no">✖ Not quite. You entered ${fmtValue(g,u)}; allowed ±${fmtValue(allowed,u)}.<br/>True: <b>${fmtValue(target,u)}</b></span>`;
      }
      updateStats();
    }
  }

  function shuffleRange(){
    const opts = RANGES[state.mode];
    const i = Math.floor(Math.random()*opts.length);
    rangeSel.selectedIndex = i;
    state.range = opts[i];

    title.textContent = `Range: ${modeSel.options[modeSel.selectedIndex].text} - ${rangeSel.options[rangeSel.selectedIndex].text}`;
  }

  function shuffleMode(){
    const opts = Object.keys(RANGES);
    const i = Math.floor(Math.random()*opts.length);
    modeSel.selectedIndex = i;
    state.mode = opts[i];
    setRangeOptions();
    shuffleRange();
  }

  function resetScore(){
    state.rounds = 0; state.correct = 0; state.streak = 0; updateStats(); feedback.textContent = '';
  }
  function updateStats(){ statRounds.textContent = state.rounds; statCorrect.textContent = state.correct; statStreak.textContent = state.streak; }

  // ====== Events ======
  modeSel.addEventListener('change', ()=>{ setRangeOptions(); newRound(); });
  rangeSel.addEventListener('change', ()=>{ state.range = RANGES[state.mode][rangeSel.selectedIndex]; newRound(); });
  // tol.addEventListener('input', ()=> tolVal.textContent = tol.value );
  document.getElementById('new').addEventListener('click', newRound);
  // document.getElementById('shuffle').addEventListener('click', shuffleRange);
  document.getElementById('reset').addEventListener('click', resetScore);
  document.getElementById('check').addEventListener('click', checkAnswer);
  document.getElementById('reveal').addEventListener('click', ()=>{
    const u = unitsForMode();
    feedback.innerHTML = `<span class="ok">True value: <b>${fmtValue(state.trueValue, u)}</b></span>`;
    document.getElementById('check').disabled = true;
  });
  guess.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') checkAnswer(); });

  // ====== Init ======
  (function init(){ buildMultiscaleFace(); setRangeOptions(); setNeedleByFraction(0); setTimeout(newRound, 150); })();