// ═══════════════════════════════════════════════════════════
//  A B Y S S  —  Infinite Descent
//  A WebGL browser game built with Three.js
//  Zero external assets — fully procedural
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import './style.css';

// ─── Constants ─────────────────────────────────────────────

const TAU = Math.PI * 2;

const TUNNEL_RADIUS = 10;
const RING_COUNT = 80;
const RING_SPACING = 4;
const RING_TUBE = 0.045;

const GATE_POOL = 16;
const GATE_SPACING = 30;
const GATE_INITIAL_GAP = Math.PI * 0.9;   // ~162° opening
const GATE_MIN_GAP = Math.PI * 0.26;      // ~47° opening
const GATE_GAP_SHRINK = 0.010;            // gap tightens ~2× faster for a tenser mid-game
const GATE_FIRST_Z = 140;  // First gate distance — gives time to orient

const PLAYER_RADIUS = 0.4;
const PLAYER_MAX_R = 8.5;
const PLAYER_SMOOTH = 6;

const SPEED_INIT = 18;
const SPEED_MAX = 130;
const SPEED_ACCEL = 0.7;   // gentle but noticeable build so runs gain intensity

const TOUCH_AIM_SENS = 1.35; // relative-drag gain (screen fractions → aim)

// Adaptive quality — bloom/DPR are the biggest costs on mobile
const IS_MOBILE = matchMedia('(max-width: 768px), (pointer: coarse)').matches;
const USE_RELATIVE_AIM = matchMedia('(pointer: coarse)').matches || IS_MOBILE;
const REDUCE_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LOW_POWER = IS_MOBILE || (navigator.hardwareConcurrency ?? 8) <= 4;
const MAX_DPR = LOW_POWER ? 1.25 : 1.75;
const TRAIL_COUNT = LOW_POWER ? 180 : 320;
const STAR_COUNT = LOW_POWER ? 1200 : 2200;
const USE_BLOOM = !LOW_POWER;
const BARRIER_RING_STEP = LOW_POWER ? 1.4 : 1.0;

const DEPTH_MILESTONES = [250, 500, 1000, 2000, 3500, 5000, 7500, 10000, 15000, 20000];

const MUTE_KEY = 'abyss-muted';
const BEST_KEY = 'abyss-best';
const LB_KEY = 'abyss-leaderboard';
const LB_MAX = 10;

// ─── Color Palette ─────────────────────────────────────────

const PALETTE = [
  new THREE.Color(0x00e5ff),   // cyan
  new THREE.Color(0x6366f1),   // indigo
  new THREE.Color(0xc026d3),   // fuchsia
  new THREE.Color(0xf43f5e),   // rose
  new THREE.Color(0xfbbf24),   // amber
];

const _paletteScratch = new THREE.Color();

function lerpPalette(t: number, out: THREE.Color = _paletteScratch): THREE.Color {
  t = Math.min(Math.max(t, 0), 1);
  const n = PALETTE.length - 1;
  const i = Math.min(Math.floor(t * n), n - 1);
  const f = t * n - i;
  return out.copy(PALETTE[i]).lerp(PALETTE[i + 1], f);
}

function haptic(pattern: number | number[]) {
  try {
    if (USE_RELATIVE_AIM && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch { /* unsupported */ }
}

function setPanelVisible(el: HTMLElement, visible: boolean) {
  el.classList.toggle('hidden', !visible);
  el.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if ('inert' in el) {
    (el as HTMLElement & { inert: boolean }).inert = !visible;
  }
}

// ─── Shaders ───────────────────────────────────────────────

const ChromaShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: 0.003 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec2 d = amount * (vUv - 0.5);
      gl_FragColor = vec4(
        texture2D(tDiffuse, vUv + d).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - d).b,
        1.0
      );
    }
  `,
};

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    darkness: { value: 1.5 },
    offset: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float darkness;
    uniform float offset;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = length((vUv - 0.5) * 2.0);
      float v = smoothstep(offset, offset - 0.45, d * (darkness + offset));
      gl_FragColor = vec4(c.rgb * v, 1.0);
    }
  `,
};

// ─── Procedural Audio ──────────────────────────────────────

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private drone: OscillatorNode | null = null;
  private drone2: OscillatorNode | null = null;
  private pulse: OscillatorNode | null = null;
  private pulseGain: GainNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private shimmer: OscillatorNode | null = null;
  private shimmerGain: GainNode | null = null;
  private muted = false;

  init() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.2;
      this.master.connect(this.ctx.destination);

      this.droneBus = this.ctx.createGain();
      this.droneBus.gain.value = 1;
      this.droneBus.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.master);
    } catch { /* audio unavailable */ }
  }

  resume() { this.ctx?.resume(); }

  /** Suspend all audio processing (tab hidden) — saves CPU and silences bleed. */
  suspend() {
    try { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); } catch { /* ok */ }
  }

  isMuted() { return this.muted; }

  setMuted(muted: boolean) {
    this.muted = muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ok */ }
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.2, this.ctx?.currentTime ?? 0, 0.03);
    }
  }

  startDrone() {
    if (!this.ctx || !this.droneBus) return;
    this.stopDrone();

    const g1 = this.ctx.createGain();
    g1.gain.value = 0.1;
    g1.connect(this.droneBus);
    this.drone = this.ctx.createOscillator();
    this.drone.type = 'sine';
    this.drone.frequency.value = 55;
    this.drone.connect(g1);
    this.drone.start();

    const g2 = this.ctx.createGain();
    g2.gain.value = 0.05;
    g2.connect(this.droneBus);
    this.drone2 = this.ctx.createOscillator();
    this.drone2.type = 'sine';
    this.drone2.frequency.value = 82.5;
    this.drone2.connect(g2);
    this.drone2.start();

    // Momentum pulse — a sub-bass throb gated by an LFO. Its rate and depth
    // rise with speed so the mix physically tightens as things get faster.
    this.pulseGain = this.ctx.createGain();
    this.pulseGain.gain.value = 0.0;
    this.pulseGain.connect(this.droneBus);
    this.pulse = this.ctx.createOscillator();
    this.pulse.type = 'triangle';
    this.pulse.frequency.value = 36.7; // D1
    this.pulse.connect(this.pulseGain);
    this.pulse.start();

    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = 0.09;
    this.lfoGain.connect(this.pulseGain.gain);
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 1.6;
    this.lfo.connect(this.lfoGain);
    this.lfo.start();

    // Shimmer — a faint high fifth that fades in at speed for tension.
    this.shimmerGain = this.ctx.createGain();
    this.shimmerGain.gain.value = 0.0;
    this.shimmerGain.connect(this.droneBus);
    this.shimmer = this.ctx.createOscillator();
    this.shimmer.type = 'sine';
    this.shimmer.frequency.value = 330;
    this.shimmer.connect(this.shimmerGain);
    this.shimmer.start();
  }

  setDronePitch(t: number) {
    const now = this.ctx?.currentTime ?? 0;
    if (this.drone) this.drone.frequency.value = 55 + t * 60;
    if (this.drone2) this.drone2.frequency.value = 82.5 + t * 90;
    // Pulse quickens (1.6→5.5 Hz) and deepens; shimmer swells late in the run.
    if (this.lfo) this.lfo.frequency.setTargetAtTime(1.6 + t * 3.9, now, 0.3);
    if (this.lfoGain) this.lfoGain.gain.setTargetAtTime(0.09 + t * 0.05, now, 0.3);
    if (this.pulseGain) this.pulseGain.gain.setTargetAtTime(0.08 + t * 0.05, now, 0.3);
    if (this.shimmerGain) this.shimmerGain.gain.setTargetAtTime(t * t * 0.03, now, 0.4);
  }

  playPass() {
    if (!this.ctx || !this.sfxBus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 600 + Math.random() * 600;
    g.gain.setValueAtTime(0.12, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start();
    o.stop(this.ctx.currentTime + 0.15);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  playDeath() {
    if (!this.ctx || !this.sfxBus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 1.2);
    g.gain.setValueAtTime(0.3, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.2);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start();
    o.stop(this.ctx.currentTime + 1.2);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  playNearMiss() {
    if (!this.ctx || !this.sfxBus) return;
    // Filtered noise-like whoosh via a fast downward sweep — a "close call" cue.
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2600, this.ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(700, this.ctx.currentTime + 0.22);
    f.Q.value = 1.4;
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1200, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(420, this.ctx.currentTime + 0.22);
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.13, this.ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.24);
    o.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    o.start();
    o.stop(this.ctx.currentTime + 0.26);
    o.onended = () => { o.disconnect(); f.disconnect(); g.disconnect(); };
  }

  playNewBest() {
    if (!this.ctx || !this.sfxBus) return;
    // Rising arpeggio — a small triumphant sting for a fresh record.
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const t = this.ctx!.currentTime + i * 0.09;
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g);
      g.connect(this.sfxBus!);
      o.start(t);
      o.stop(t + 0.36);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    });
  }

  stopDrone() {
    const nodes = [this.drone, this.drone2, this.pulse, this.lfo, this.shimmer];
    for (const n of nodes) {
      try { n?.stop(); } catch { /* ok */ }
      try { n?.disconnect(); } catch { /* ok */ }
    }
    for (const g of [this.pulseGain, this.lfoGain, this.shimmerGain]) {
      try { g?.disconnect(); } catch { /* ok */ }
    }
    this.drone = null;
    this.drone2 = null;
    this.pulse = null;
    this.pulseGain = null;
    this.lfo = null;
    this.lfoGain = null;
    this.shimmer = null;
    this.shimmerGain = null;
  }
}

// ─── Gate Data ─────────────────────────────────────────────

interface GateData {
  group: THREE.Group;
  z: number;
  gapAngle: number;    // where group rotation places the gap center
  gapSize: number;
  passed: boolean;
  active: boolean;
  flashTimer: number;
}

const DANGER_COLOR = new THREE.Color(0xff2244);
const SAFE_COLOR = new THREE.Color(0x00ff88);
const SAFE_EDGE_RADII = [TUNNEL_RADIUS * 0.95, TUNNEL_RADIUS * 0.7, TUNNEL_RADIUS * 0.45, 0.5];

function clearGroup(group: THREE.Group) {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const c = group.children[i] as THREE.Mesh;
    group.remove(c);
    c.geometry?.dispose();
    const mat = c.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  }
}

function fillGate(group: THREE.Group, gapSize: number) {
  clearGroup(group);

  const barrierLen = TAU - gapSize;
  const radialSegs = LOW_POWER ? 32 : 48;

  // Concentric barrier rings — alternating opacity as non-color danger cue
  let ringIdx = 0;
  for (let r = 0.5; r <= TUNNEL_RADIUS; r += BARRIER_RING_STEP) {
    const geo = new THREE.TorusGeometry(r, 0.12, 6, radialSegs, barrierLen);
    const mat = new THREE.MeshBasicMaterial({
      color: DANGER_COLOR,
      transparent: true,
      opacity: ringIdx % 2 === 0 ? 0.95 : 0.55,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = gapSize / 2;
    group.add(mesh);
    ringIdx++;
  }

  // Solid fill disc
  const discGeo = new THREE.RingGeometry(0.01, TUNNEL_RADIUS, radialSegs, 1, gapSize / 2, barrierLen);
  const discMat = new THREE.MeshBasicMaterial({
    color: DANGER_COLOR,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35,
  });
  group.add(new THREE.Mesh(discGeo, discMat));

  // Outer rim
  const rimGeo = new THREE.TorusGeometry(TUNNEL_RADIUS, 0.22, 6, radialSegs, barrierLen);
  const rim = new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color: 0xff6644 }));
  rim.rotation.z = gapSize / 2;
  group.add(rim);

  // Safe-gap arcs (extra rings = shape cue beyond color)
  for (const edgeR of SAFE_EDGE_RADII) {
    const tube = edgeR > TUNNEL_RADIUS * 0.8 ? 0.18 : 0.12;
    const arcGeo = new THREE.TorusGeometry(edgeR, tube, 6, 28, gapSize);
    const arc = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: SAFE_COLOR }));
    arc.rotation.z = -gapSize / 2;
    group.add(arc);
  }

  // Gap edge bars — bright radial markers (chevrons via thickness)
  for (const side of [-1, 1] as const) {
    const edgeAngle = (gapSize / 2) * side;
    const barGeo = new THREE.PlaneGeometry(0.22, TUNNEL_RADIUS * 2);
    const barMat = new THREE.MeshBasicMaterial({
      color: SAFE_COLOR,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.set(
      Math.cos(edgeAngle) * TUNNEL_RADIUS * 0.5,
      Math.sin(edgeAngle) * TUNNEL_RADIUS * 0.5,
      0,
    );
    bar.rotation.z = edgeAngle;
    group.add(bar);

    // Second thicker chevron mark near the rim
    const tipGeo = new THREE.PlaneGeometry(0.35, 1.2);
    const tip = new THREE.Mesh(tipGeo, barMat.clone());
    tip.position.set(
      Math.cos(edgeAngle) * TUNNEL_RADIUS * 0.92,
      Math.sin(edgeAngle) * TUNNEL_RADIUS * 0.92,
      0.05,
    );
    tip.rotation.z = edgeAngle;
    group.add(tip);
  }
}

// ─── Leaderboard ───────────────────────────────────────────

interface LeaderboardEntry {
  id: string;
  score: number;
  depth: number;
  date: string;
}

function getLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LB_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is LeaderboardEntry => e && typeof e.score === 'number')
      .map((e) => ({
        id: typeof e.id === 'string' ? e.id : `${e.score}-${e.depth}-${e.date}`,
        score: e.score,
        depth: e.depth,
        date: e.date,
      }))
      .slice(0, LB_MAX);
  } catch { return []; }
}

/** Returns entry id when inserted, or null if skipped. */
function addToLeaderboard(score: number, depth: number): string | null {
  if (score <= 0) return null;

  const entries = getLeaderboard();
  const entry: LeaderboardEntry = {
    id: `${Date.now()}-${score}-${Math.random().toString(36).slice(2, 8)}`,
    score,
    depth: Math.floor(depth),
    date: new Date().toLocaleDateString(),
  };
  entries.push(entry);
  entries.sort((a, b) => b.score - a.score);
  const trimmed = entries.slice(0, LB_MAX);
  try { localStorage.setItem(LB_KEY, JSON.stringify(trimmed)); } catch { /* ok */ }
  return trimmed.some((e) => e.id === entry.id) ? entry.id : null;
}

function renderLeaderboard(listEl: HTMLOListElement, highlightId: string | null) {
  const entries = getLeaderboard();
  listEl.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.style.justifyContent = 'center';
    empty.style.color = 'rgba(255,255,255,0.35)';
    empty.textContent = 'No runs yet';
    listEl.appendChild(empty);
    return;
  }

  const medals = ['lb-gold', 'lb-silver', 'lb-bronze'];

  entries.forEach((entry, i) => {
    const li = document.createElement('li');
    if (highlightId && entry.id === highlightId) li.classList.add('lb-current');
    if (i < 3) li.classList.add(medals[i]);

    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    rank.textContent = `#${i + 1}`;

    const score = document.createElement('span');
    score.className = 'lb-score';
    score.textContent = String(entry.score);

    const depth = document.createElement('span');
    depth.className = 'lb-depth';
    depth.textContent = `${entry.depth}m`;

    li.append(rank, score, depth);
    listEl.appendChild(li);
  });
}

// ─── UI Manager ────────────────────────────────────────────

class UI {
  private startScreen = document.getElementById('start-screen')!;
  private hud = document.getElementById('hud')!;
  private pauseScreen = document.getElementById('pause-screen')!;
  private gameOver = document.getElementById('game-over')!;
  private scoreEl = document.getElementById('score')!;
  private depthEl = document.getElementById('depth')!;
  private finalScoreEl = document.getElementById('final-score')!;
  private bestScoreEl = document.getElementById('best-score')!;
  private newRecordEl = document.getElementById('new-record')!;
  private startBestEl = document.getElementById('start-best')!;
  private runStatsEl = document.getElementById('run-stats')!;
  private startBtn = document.getElementById('start-btn')!;
  private retryBtn = document.getElementById('retry-btn')!;
  private resumeBtn = document.getElementById('resume-btn')!;
  private pauseBtn = document.getElementById('pause-btn')!;
  private muteStart = document.getElementById('mute-btn-start')!;
  private mutePause = document.getElementById('mute-btn-pause')!;
  private tutorialEl = document.getElementById('tutorial')!;
  private controlsDetail = document.getElementById('controls-detail')!;
  private tutorialSub = document.getElementById('tutorial-sub')!;
  private startHint = document.getElementById('start-hint')!;
  private leaderboardList = document.getElementById('leaderboard-list') as HTMLOListElement;
  private flashEl = document.getElementById('screen-flash')!;
  private milestoneEl = document.getElementById('milestone')!;
  private tutorialTimer = 0;
  private flashTimer = 0;
  private scorePulseTimer = 0;
  private milestoneTimer = 0;

  onStart: (() => void) | null = null;
  onRetry: (() => void) | null = null;
  onPauseToggle: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onMuteToggle: (() => void) | null = null;

  constructor() {
    this.applyDeviceCopy();

    this.startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onStart?.();
    });

    this.retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onRetry?.();
    });

    this.resumeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onResume?.();
    });

    this.pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onPauseToggle?.();
    });

    const onMute = (e: Event) => {
      e.stopPropagation();
      this.onMuteToggle?.();
    };
    this.muteStart.addEventListener('click', onMute);
    this.mutePause.addEventListener('click', onMute);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        if (!this.startScreen.classList.contains('hidden')) {
          e.preventDefault();
          this.onStart?.();
        } else if (!this.gameOver.classList.contains('hidden')) {
          e.preventDefault();
          this.onRetry?.();
        } else if (!this.pauseScreen.classList.contains('hidden')) {
          e.preventDefault();
          this.onResume?.();
        }
      }
      if (e.code === 'Escape') {
        this.onPauseToggle?.();
      }
    });
  }

  private applyDeviceCopy() {
    if (USE_RELATIVE_AIM) {
      this.controlsDetail.textContent = 'Drag to steer — thumb anywhere on screen';
      this.tutorialSub.textContent = 'Drag your finger to steer through the gaps';
      this.startHint.textContent = 'Press START or SPACE to begin';
    } else {
      this.controlsDetail.textContent = 'Mouse to aim · WASD / Arrows to steer';
      this.tutorialSub.textContent = 'Move your mouse or press the arrow keys to steer through the gaps';
      this.startHint.textContent = 'Press SPACE or click the button to begin';
    }
  }

  syncMute(muted: boolean) {
    const label = muted ? 'SOUND OFF' : 'SOUND ON';
    for (const btn of [this.muteStart, this.mutePause]) {
      btn.textContent = label;
      btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    }
  }

  showStart() {
    setPanelVisible(this.startScreen, true);
    setPanelVisible(this.hud, false);
    setPanelVisible(this.pauseScreen, false);
    setPanelVisible(this.gameOver, false);
    // Same treatment as pause and game-over: a remote needs a visible landing spot.
    this.focusSoon(this.startBtn);
  }

  showHUD() {
    setPanelVisible(this.startScreen, false);
    setPanelVisible(this.hud, true);
    setPanelVisible(this.pauseScreen, false);
    setPanelVisible(this.gameOver, false);
  }

  showPause() {
    setPanelVisible(this.pauseScreen, true);
    this.focusSoon(this.resumeBtn);
  }

  private focusSoon(el: HTMLElement) {
    // Panels fade in via a visibility transition, so the element stays
    // non-focusable until it settles. Poll briefly until it can take focus.
    let attempts = 0;
    const tryFocus = () => {
      attempts++;
      if (getComputedStyle(el).visibility !== 'hidden') {
        try { el.focus({ preventScroll: true }); } catch { /* ok */ }
        return;
      }
      if (attempts < 16) window.setTimeout(tryFocus, 40);
    };
    tryFocus();
  }

  hidePause() {
    setPanelVisible(this.pauseScreen, false);
  }

  showTutorial() {
    setPanelVisible(this.tutorialEl, true);
    clearTimeout(this.tutorialTimer);
    this.tutorialTimer = window.setTimeout(() => {
      setPanelVisible(this.tutorialEl, false);
    }, 4000);
  }

  showGameOver(score: number, best: number, depth: number, isNewBest: boolean, nearMiss: number) {
    setPanelVisible(this.hud, false);
    setPanelVisible(this.pauseScreen, false);
    setPanelVisible(this.gameOver, true);
    this.finalScoreEl.textContent = String(score);
    this.bestScoreEl.textContent = `BEST: ${best}`;
    this.renderRunStats(depth, nearMiss);
    this.newRecordEl.classList.toggle('hidden', !isNewBest);
    this.newRecordEl.setAttribute('aria-hidden', isNewBest ? 'false' : 'true');
    this.gameOver.classList.toggle('is-record', isNewBest);
    const id = addToLeaderboard(score, depth);
    renderLeaderboard(this.leaderboardList, id);
    this.focusSoon(this.retryBtn);
  }

  private renderRunStats(depth: number, nearMiss: number) {
    const stat = (value: string, label: string) => {
      const cell = document.createElement('div');
      cell.className = 'stat-cell';
      const v = document.createElement('span');
      v.className = 'stat-value';
      v.textContent = value;
      const l = document.createElement('span');
      l.className = 'stat-label';
      l.textContent = label;
      cell.append(v, l);
      return cell;
    };
    this.runStatsEl.replaceChildren(
      stat(`${Math.floor(depth)}m`, 'DEPTH'),
      stat(String(nearMiss), nearMiss === 1 ? 'NEAR MISS' : 'NEAR MISSES'),
    );
  }

  setBest(best: number) {
    if (best > 0) {
      this.startBestEl.textContent = `BEST ${best}`;
      this.startBestEl.classList.remove('hidden');
      this.startBestEl.setAttribute('aria-hidden', 'false');
    } else {
      this.startBestEl.classList.add('hidden');
      this.startBestEl.setAttribute('aria-hidden', 'true');
    }
  }

  updateScore(score: number) {
    this.scoreEl.textContent = String(score);
  }

  markScoreBest(isBest: boolean) {
    this.scoreEl.classList.toggle('score-best', isBest);
  }

  pulseScore() {
    this.scoreEl.classList.add('score-pulse');
    clearTimeout(this.scorePulseTimer);
    this.scorePulseTimer = window.setTimeout(() => {
      this.scoreEl.classList.remove('score-pulse');
    }, 140);
  }

  flash(kind: 'pass' | 'death') {
    if (REDUCE_MOTION) return;
    this.flashEl.classList.remove('flash-pass', 'flash-death');
    // Force reflow so re-adding the class retriggers
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add(kind === 'pass' ? 'flash-pass' : 'flash-death');
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashEl.classList.remove('flash-pass', 'flash-death');
    }, kind === 'death' ? 220 : 90);
  }

  updateDepth(depth: number) {
    this.depthEl.textContent = `DEPTH ${Math.floor(depth)}m`;
  }

  showMilestone(text: string) {
    this.milestoneEl.textContent = text;
    this.milestoneEl.classList.remove('hidden', 'milestone-show');
    void this.milestoneEl.offsetWidth; // restart animation
    this.milestoneEl.classList.add('milestone-show');
    clearTimeout(this.milestoneTimer);
    this.milestoneTimer = window.setTimeout(() => {
      this.milestoneEl.classList.add('hidden');
      this.milestoneEl.classList.remove('milestone-show');
    }, 1500);
  }

  hideMilestone() {
    clearTimeout(this.milestoneTimer);
    this.milestoneEl.classList.add('hidden');
    this.milestoneEl.classList.remove('milestone-show');
  }
}

// ─── Main Game ─────────────────────────────────────────────

class AbyssGame {
  // Three.js core
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private chromaPass!: ShaderPass;
  private vignettePass!: ShaderPass;
  private bloomPass!: UnrealBloomPass;

  // World objects
  private tunnelRings: THREE.Mesh[] = [];
  private gates: GateData[] = [];
  private playerMesh!: THREE.Mesh;
  private playerGlow!: THREE.PointLight;
  private starfield!: THREE.Points;

  // Trail
  private trailGeo!: THREE.BufferGeometry;
  private trailPos!: Float32Array;
  private trailCol!: Float32Array;
  private trailHead = 0;

  // State
  private alive = false;
  private started = false;
  private paused = false;
  private score = 0;
  private bestScore = 0;
  private depth = 0;
  private speed = SPEED_INIT;
  private playerX = 0;
  private playerY = 0;
  private targetX = 0;
  private targetY = 0;
  private cameraZ = 0;
  private prevZ = 0;
  private gapSize = GATE_INITIAL_GAP;
  private lastGapAngle = 0;
  private milestoneIdx = 0;
  private nearMissCount = 0;
  private beatBestThisRun = false;
  private colorProgress = 0;
  private shakeAmount = 0;
  private nearMissPulse = 0;
  private camLeanX = 0;
  private camLeanY = 0;
  private camRoll = 0;
  private lastTime = 0;
  private ambientRaf = 0;
  private gameRaf = 0;
  private deathAnimRaf = 0;
  private deathStart = 0;
  private deathTimeout = 0;
  private gameOverFallbackTimeout = 0;
  private isTransitioning = false;
  private gameOverShown = false;
  private tabHidden = false;

  // Input
  private pointerX = 0.5;
  private pointerY = 0.5;
  private keys = new Set<string>();
  private dragActive = false;
  private dragOriginX = 0;
  private dragOriginY = 0;
  private aimAtDragStartX = 0.5;
  private aimAtDragStartY = 0.5;

  // Recycling trackers (avoid O(n²) furthest-scan)
  private tunnelFarZ = 0;
  private gateFarZ = 0;

  // Shared color scratch for theme updates
  private themeCol = new THREE.Color();

  // Audio
  private audio = new AudioEngine();

  constructor(private ui: UI) {
    this.bestScore = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
  }

  init() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000008, 0.006);

    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 600);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, 100);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !LOW_POWER,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_DPR));
    this.renderer.setClearColor(0x000008);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      USE_BLOOM ? 1.6 : 0,
      0.4,
      0.15,
    );
    if (USE_BLOOM) this.composer.addPass(this.bloomPass);

    this.chromaPass = new ShaderPass(ChromaShader as any);
    this.composer.addPass(this.chromaPass);

    this.vignettePass = new ShaderPass(VignetteShader as any);
    this.composer.addPass(this.vignettePass);

    this.buildTunnel();
    this.buildGates();
    this.buildPlayer();
    this.buildStarfield();
    this.buildTrail();

    this.audio.init();
    this.ui.syncMute(this.audio.isMuted());
    this.ui.setBest(this.bestScore);

    this.setupInput(canvas);

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('blur', () => {
      if (this.alive && !this.paused) this.setPaused(true);
    });

    this.ui.onStart = () => this.start();
    this.ui.onRetry = () => this.restart();
    this.ui.onPauseToggle = () => {
      if (!this.alive && !this.paused) return;
      if (this.alive || this.paused) this.setPaused(!this.paused);
    };
    this.ui.onResume = () => this.setPaused(false);
    this.ui.onMuteToggle = () => {
      this.audio.setMuted(!this.audio.isMuted());
      this.ui.syncMute(this.audio.isMuted());
      this.audio.resume();
    };

    this.ui.showStart();
    this.renderAmbient();
  }

  // ─── Build Methods ───────────────────

  private buildTunnel() {
    const col = lerpPalette(0);
    this.tunnelFarZ = (RING_COUNT - 1) * RING_SPACING;
    for (let i = 0; i < RING_COUNT; i++) {
      const geo = new THREE.TorusGeometry(TUNNEL_RADIUS, RING_TUBE, 6, LOW_POWER ? 48 : 64);
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.35,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = i * RING_SPACING;
      this.scene.add(mesh);
      this.tunnelRings.push(mesh);
    }
  }

  private buildGates() {
    this.gateFarZ = GATE_FIRST_Z + (GATE_POOL - 1) * GATE_SPACING;
    for (let i = 0; i < GATE_POOL; i++) {
      const group = new THREE.Group();
      fillGate(group, GATE_INITIAL_GAP);
      group.position.z = GATE_FIRST_Z + i * GATE_SPACING;
      group.rotation.z = Math.random() * TAU;
      group.visible = false;
      this.scene.add(group);
      this.gates.push({
        group,
        z: group.position.z,
        gapAngle: group.rotation.z,
        gapSize: GATE_INITIAL_GAP,
        passed: false,
        active: false,
        flashTimer: 0,
      });
    }
  }

  private buildPlayer() {
    const geo = new THREE.IcosahedronGeometry(PLAYER_RADIUS, 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    this.playerMesh = new THREE.Mesh(geo, mat);
    this.playerMesh.position.set(0, 0, 10);
    this.scene.add(this.playerMesh);

    this.playerGlow = new THREE.PointLight(0x00e5ff, 3, 20);
    this.playerMesh.add(this.playerGlow);
  }

  private buildStarfield() {
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const theta = Math.random() * TAU;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 40 + Math.random() * 250;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.4,
      color: 0x334455,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.starfield = new THREE.Points(geo, mat);
    this.scene.add(this.starfield);
  }

  private buildTrail() {
    this.trailPos = new Float32Array(TRAIL_COUNT * 3);
    this.trailCol = new Float32Array(TRAIL_COUNT * 3);

    for (let i = 0; i < TRAIL_COUNT; i++) {
      this.trailPos[i * 3 + 2] = -9999;
    }

    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.25,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.scene.add(new THREE.Points(this.trailGeo, mat));
  }

  // ─── Input ───────────────────────────

  private setupInput(canvas: HTMLCanvasElement) {
    const setAbsolute = (x: number, y: number) => {
      this.pointerX = Math.min(1, Math.max(0, x / innerWidth));
      this.pointerY = Math.min(1, Math.max(0, y / innerHeight));
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.alive || this.paused) return;
      canvas.setPointerCapture(e.pointerId);
      if (USE_RELATIVE_AIM || e.pointerType === 'touch') {
        this.dragActive = true;
        this.dragOriginX = e.clientX;
        this.dragOriginY = e.clientY;
        this.aimAtDragStartX = this.pointerX;
        this.aimAtDragStartY = this.pointerY;
      } else {
        setAbsolute(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.alive || this.paused) return;
      if (this.dragActive) {
        const dx = (e.clientX - this.dragOriginX) / innerWidth;
        const dy = (e.clientY - this.dragOriginY) / innerHeight;
        this.pointerX = Math.min(1, Math.max(0, this.aimAtDragStartX + dx * TOUCH_AIM_SENS));
        this.pointerY = Math.min(1, Math.max(0, this.aimAtDragStartY + dy * TOUCH_AIM_SENS));
      } else if (!USE_RELATIVE_AIM && e.pointerType !== 'touch') {
        setAbsolute(e.clientX, e.clientY);
      }
    });

    const endDrag = (e: PointerEvent) => {
      this.dragActive = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ok */ }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())
          || e.code === 'Space') {
        if (this.alive) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  private pollKeys() {
    if (!this.alive || this.paused) return;
    const step = 0.03;
    if (this.keys.has('a') || this.keys.has('arrowleft'))  this.pointerX = Math.max(0, this.pointerX - step);
    if (this.keys.has('d') || this.keys.has('arrowright')) this.pointerX = Math.min(1, this.pointerX + step);
    if (this.keys.has('w') || this.keys.has('arrowup'))    this.pointerY = Math.max(0, this.pointerY - step);
    if (this.keys.has('s') || this.keys.has('arrowdown'))  this.pointerY = Math.min(1, this.pointerY + step);
  }

  // ─── Pause / visibility ──────────────

  private onVisibility() {
    this.tabHidden = document.hidden;
    if (document.hidden) {
      if (this.alive && !this.paused) this.setPaused(true);
      cancelAnimationFrame(this.ambientRaf);
      cancelAnimationFrame(this.gameRaf);
      cancelAnimationFrame(this.deathAnimRaf);
      this.audio.suspend();
    } else {
      // Restore audio context on return (mute state is preserved by master gain).
      this.audio.resume();
      if (!this.paused && !this.alive) {
        // Resume ambient when on menus; game loop resumes via setPaused(false)
        this.ambientStart = 0;
        this.renderAmbient();
      }
    }
  }

  private setPaused(paused: boolean) {
    if (!this.alive && !this.paused && paused) return;
    if (this.isTransitioning) return;

    // Only pause during an active run
    if (paused && !this.alive) return;

    this.paused = paused;
    if (paused) {
      this.ui.showPause();
      cancelAnimationFrame(this.gameRaf);
      // Keep a frozen frame visible — ambient not needed
    } else {
      this.ui.hidePause();
      if (this.alive) {
        this.lastTime = performance.now();
        this.gameLoop();
      }
    }
  }

  // ─── Game Flow ───────────────────────

  start() {
    if (this.isTransitioning) return;

    clearTimeout(this.deathTimeout);
    clearTimeout(this.gameOverFallbackTimeout);
    cancelAnimationFrame(this.gameRaf);
    cancelAnimationFrame(this.ambientRaf);
    cancelAnimationFrame(this.deathAnimRaf);

    this.isTransitioning = false;
    this.gameOverShown = false;
    this.paused = false;
    this.dragActive = false;

    this.audio.resume();
    this.audio.startDrone();

    this.alive = true;
    this.started = true;
    this.score = 0;
    this.depth = 0;
    this.speed = SPEED_INIT;
    this.cameraZ = 0;
    this.prevZ = 0;
    this.playerX = 0;
    this.playerY = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.pointerX = 0.5;
    this.pointerY = 0.5;
    this.gapSize = GATE_INITIAL_GAP;
    this.milestoneIdx = 0;
    this.nearMissCount = 0;
    this.beatBestThisRun = false;
    this.colorProgress = 0;
    this.shakeAmount = 0;
    this.nearMissPulse = 0;
    this.camLeanX = 0;
    this.camLeanY = 0;
    this.camRoll = 0;
    this.trailHead = 0;

    for (let i = 0; i < TRAIL_COUNT; i++) {
      this.trailPos[i * 3 + 2] = -9999;
      this.trailCol[i * 3] = 0;
      this.trailCol[i * 3 + 1] = 0;
      this.trailCol[i * 3 + 2] = 0;
    }

    this.tunnelFarZ = (this.tunnelRings.length - 1) * RING_SPACING;
    for (let i = 0; i < this.tunnelRings.length; i++) {
      this.tunnelRings[i].position.z = i * RING_SPACING;
    }

    this.gateFarZ = GATE_FIRST_Z + (this.gates.length - 1) * GATE_SPACING;
    this.lastGapAngle = Math.random() * TAU;
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      g.z = GATE_FIRST_Z + i * GATE_SPACING;
      g.group.position.z = g.z;
      const angle = i === 0 ? this.lastGapAngle : this.nextGapAngle();
      g.group.rotation.z = angle;
      g.gapAngle = angle;
      const prevGap = g.gapSize;
      g.gapSize = GATE_INITIAL_GAP;
      g.passed = false;
      g.active = true;
      g.flashTimer = 0;
      g.group.visible = true;
      g.group.scale.setScalar(1);
      if (Math.abs(prevGap - GATE_INITIAL_GAP) > 0.001 || g.group.children.length === 0) {
        fillGate(g.group, GATE_INITIAL_GAP);
      }
    }

    this.camera.position.set(0, 0, 0);
    this.camera.fov = 75;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, 100);

    this.playerMesh.visible = true;
    this.playerMesh.scale.setScalar(1);
    (this.playerMesh.material as THREE.MeshBasicMaterial).opacity = 1;
    (this.vignettePass.uniforms as any).offset.value = 1.0;
    (this.vignettePass.uniforms as any).darkness.value = 1.5;

    this.ui.hidePause();
    this.ui.hideMilestone();
    this.ui.showHUD();
    this.ui.showTutorial();
    this.ui.updateScore(0);
    this.ui.updateDepth(0);
    this.ui.markScoreBest(false);

    this.lastTime = performance.now();
    this.gameLoop();
  }

  private die() {
    if (!this.alive || this.isTransitioning) return;

    this.isTransitioning = true;
    this.alive = false;
    this.paused = false;
    this.ui.hidePause();
    this.ui.hideMilestone();
    this.audio.playDeath();
    this.audio.stopDrone();
    this.ui.flash('death');
    haptic([40, 30, 80]);
    this.shakeAmount = 1.3; // hard camera punch on impact

    cancelAnimationFrame(this.gameRaf);

    const isNewBest = this.score > 0 && this.score > this.bestScore;
    if (isNewBest) {
      this.bestScore = this.score;
      try { localStorage.setItem(BEST_KEY, String(this.bestScore)); } catch { /* ok */ }
    }

    const finalScore = this.score;
    const finalBest = this.bestScore;
    const finalDepth = this.depth;
    const finalNearMiss = this.nearMissCount;

    this.started = false;

    // Hold on the death scene and play a shatter burst instead of hard-cutting
    // to the ambient orbit — the impact is the dramatic beat.
    if (!this.tabHidden) {
      this.deathStart = performance.now();
      cancelAnimationFrame(this.deathAnimRaf);
      this.deathAnim();
    }

    clearTimeout(this.deathTimeout);
    clearTimeout(this.gameOverFallbackTimeout);
    this.deathTimeout = window.setTimeout(() => {
      this.showGameOverOnce(finalScore, finalBest, finalDepth, isNewBest, finalNearMiss);
    }, 600);

    this.gameOverFallbackTimeout = window.setTimeout(() => {
      this.showGameOverOnce(finalScore, finalBest, finalDepth, isNewBest, finalNearMiss);
    }, 1500);
  }

  private showGameOverOnce(score: number, best: number, depth: number, isNewBest: boolean, nearMiss: number) {
    // Never leave isTransitioning stuck if UI already shown or showGameOver throws.
    if (this.alive) return;
    if (this.gameOverShown) {
      this.isTransitioning = false;
      return;
    }
    this.gameOverShown = true;
    cancelAnimationFrame(this.deathAnimRaf);
    // Restore the ship + vignette so the ambient orbit behind the panel is clean.
    this.playerMesh.scale.setScalar(1);
    (this.playerMesh.material as THREE.MeshBasicMaterial).opacity = 1;
    (this.vignettePass.uniforms as any).offset.value = 1.0;
    (this.vignettePass.uniforms as any).darkness.value = 1.5;
    try {
      this.ui.showGameOver(score, best, depth, isNewBest, nearMiss);
      if (isNewBest) {
        this.audio.playNewBest();
        haptic([18, 40, 18, 40, 60]);
      }
    } finally {
      this.isTransitioning = false;
    }
    // Now hand off to the ambient orbit (hidden behind the blurred panel).
    this.ambientStart = 0;
    if (!this.tabHidden) this.renderAmbient();
  }

  private restart() {
    // Force-clear death transition so DESCEND AGAIN / SPACE always works.
    clearTimeout(this.deathTimeout);
    clearTimeout(this.gameOverFallbackTimeout);
    this.isTransitioning = false;
    this.gameOverShown = false;
    this.start();
  }

  // ─── Game Loop ───────────────────────

  private gameLoop() {
    if (!this.alive || this.paused || this.tabHidden) return;

    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.05);

    this.update(dt);
    this.render();

    this.gameRaf = requestAnimationFrame(() => this.gameLoop());
  }

  private update(dt: number) {
    this.pollKeys();

    this.speed = Math.min(this.speed + SPEED_ACCEL * dt, SPEED_MAX);
    const speedT = (this.speed - SPEED_INIT) / (SPEED_MAX - SPEED_INIT);

    // Speed-reactive FOV — widens as you accelerate for a visceral rush.
    if (!REDUCE_MOTION) {
      const targetFov = 75 + speedT * 13;
      if (Math.abs(this.camera.fov - targetFov) > 0.02) {
        this.camera.fov = targetFov;
        this.camera.updateProjectionMatrix();
      }
    }

    this.prevZ = this.cameraZ;
    this.cameraZ += this.speed * dt;
    this.depth += this.speed * dt;

    this.camera.position.z = this.cameraZ;

    this.targetX = (0.5 - this.pointerX) * 2 * PLAYER_MAX_R;
    this.targetY = -(this.pointerY - 0.5) * 2 * PLAYER_MAX_R;

    this.playerX += (this.targetX - this.playerX) * PLAYER_SMOOTH * dt;
    this.playerY += (this.targetY - this.playerY) * PLAYER_SMOOTH * dt;

    const dist = Math.sqrt(this.playerX ** 2 + this.playerY ** 2);
    if (dist > PLAYER_MAX_R) {
      this.playerX *= PLAYER_MAX_R / dist;
      this.playerY *= PLAYER_MAX_R / dist;
    }

    const playerZ = this.cameraZ + 12;
    this.playerMesh.position.set(this.playerX, this.playerY, playerZ);
    this.playerMesh.rotation.x += dt * 2;
    this.playerMesh.rotation.y += dt * 3;

    this.colorProgress = Math.min(this.score / 80, 1);
    lerpPalette(this.colorProgress, this.themeCol);

    this.playerGlow.color.copy(this.themeCol);

    this.shakeAmount *= 0.9;

    // Camera weight — bank into the steer and drift slightly toward the ship
    // so movement feels physical without pulling the gate off-centre.
    if (!REDUCE_MOTION) {
      const leanTargetX = this.playerX * 0.16;
      const leanTargetY = this.playerY * 0.16;
      const rollTarget = -this.playerX * 0.018;
      this.camLeanX += (leanTargetX - this.camLeanX) * Math.min(1, 5 * dt);
      this.camLeanY += (leanTargetY - this.camLeanY) * Math.min(1, 5 * dt);
      this.camRoll += (rollTarget - this.camRoll) * Math.min(1, 4 * dt);
    } else {
      this.camLeanX = 0;
      this.camLeanY = 0;
      this.camRoll = 0;
    }

    this.audio.setDronePitch(speedT);

    this.recycleTunnel(this.themeCol);
    this.updateGates(dt);
    this.updateTrail(this.themeCol, playerZ);

    this.starfield.position.z = this.cameraZ;

    const chromaBase = REDUCE_MOTION ? 0.0008 : 0.0015;
    const chromaGain = REDUCE_MOTION ? 0 : (LOW_POWER ? 0.004 : 0.008);
    (this.chromaPass.uniforms as any).amount.value = chromaBase + speedT * chromaGain;
    if (USE_BLOOM) {
      this.bloomPass.strength = 1.4 + speedT * 1.0;
    }

    (this.scene.fog as THREE.FogExp2).density = 0.006 + speedT * 0.003;

    // Near-miss tunnel-vision — briefly tighten the vignette and punch chroma.
    this.nearMissPulse *= 0.88;
    const vig = this.vignettePass.uniforms as any;
    vig.offset.value = 1.0 - this.nearMissPulse * 0.28;
    vig.darkness.value = 1.5 + this.nearMissPulse * 0.9;
    if (this.nearMissPulse > 0.02) {
      (this.chromaPass.uniforms as any).amount.value += this.nearMissPulse * 0.006;
    }

    this.ui.updateScore(this.score);
    this.ui.updateDepth(this.depth);

    // Depth milestones — brief, punchy callouts that mark progress.
    if (this.milestoneIdx < DEPTH_MILESTONES.length
        && this.depth >= DEPTH_MILESTONES[this.milestoneIdx]) {
      this.ui.showMilestone(`${DEPTH_MILESTONES[this.milestoneIdx]}m`);
      haptic([12, 30, 12]);
      this.milestoneIdx++;
    }
  }

  private recycleTunnel(color: THREE.Color) {
    for (const ring of this.tunnelRings) {
      if (ring.position.z < this.cameraZ - 10) {
        this.tunnelFarZ += RING_SPACING;
        ring.position.z = this.tunnelFarZ;

        const mat = ring.material as THREE.MeshBasicMaterial;
        mat.color.copy(color);
        mat.opacity = 0.25 + 0.15 * Math.sin(ring.position.z * 0.1);
      }
    }
  }

  /**
   * Advance the gap position by a bounded random step so gates form a flowing,
   * reachable line rather than random cross-tunnel teleports. The step tightens
   * as speed rises (less reaction time), which keeps deaths fair, not cheap.
   */
  private nextGapAngle(): number {
    const speedT = Math.min(Math.max((this.speed - SPEED_INIT) / (SPEED_MAX - SPEED_INIT), 0), 1);
    const maxStep = Math.PI * (0.85 - 0.4 * speedT);
    const minStep = Math.PI * 0.12;
    const mag = minStep + Math.random() * (maxStep - minStep);
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.lastGapAngle = ((this.lastGapAngle + dir * mag) % TAU + TAU) % TAU;
    return this.lastGapAngle;
  }

  private updateGates(dt: number) {
    for (const gate of this.gates) {
      if (!gate.active) continue;

      if (gate.flashTimer > 0) {
        gate.flashTimer -= dt;
        const t = Math.max(gate.flashTimer / 0.3, 0);
        gate.group.scale.setScalar(1 + (1 - t) * 0.15);
      }

      if (!gate.passed && this.prevZ + 12 < gate.z && this.cameraZ + 12 >= gate.z) {
        const pAngle = Math.atan2(this.playerY, this.playerX);
        const gAngle = gate.gapAngle;
        let diff = pAngle - gAngle;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;

        // Account for player body radius so near-miss edges feel fair
        const radial = Math.max(Math.hypot(this.playerX, this.playerY), 0.35);
        const bodyMargin = Math.asin(Math.min(1, PLAYER_RADIUS / radial));
        const halfGap = Math.max(0.02, gate.gapSize / 2 - bodyMargin);
        const inGap = Math.abs(diff) < halfGap;

        if (inGap) {
          gate.passed = true;
          gate.flashTimer = 0.3;
          this.score++;
          this.audio.playPass();
          this.ui.pulseScore();
          this.ui.flash('pass');
          haptic(12);

          // Surpassing your record mid-run — a distinct, one-time high point.
          if (!this.beatBestThisRun && this.bestScore > 0 && this.score > this.bestScore) {
            this.beatBestThisRun = true;
            this.ui.markScoreBest(true);
            this.ui.showMilestone('NEW BEST');
            this.audio.playNewBest();
            haptic([12, 30, 12]);
          }

          this.gapSize = Math.max(this.gapSize - GATE_GAP_SHRINK, GATE_MIN_GAP);

          const closeness = 1 - Math.abs(diff) / halfGap;
          if (!REDUCE_MOTION && closeness > 0.6) {
            this.shakeAmount = closeness * 0.8;
          }
          // Genuine near-miss — reward the tight squeeze with a distinct cue.
          if (closeness > 0.74) {
            this.nearMissCount++;
            this.audio.playNearMiss();
            haptic([10, 24]);
            if (!REDUCE_MOTION) this.nearMissPulse = 1;
          }
        } else {
          this.die();
          return;
        }
      }

      if (gate.z < this.cameraZ - 30) {
        this.gateFarZ += GATE_SPACING;
        const prevGap = gate.gapSize;
        gate.z = this.gateFarZ;
        gate.group.position.z = gate.z;
        const angle = this.nextGapAngle();
        gate.group.rotation.z = angle;
        gate.gapAngle = angle;
        gate.gapSize = this.gapSize;
        gate.passed = false;
        gate.flashTimer = 0;
        gate.group.scale.setScalar(1);
        if (Math.abs(prevGap - gate.gapSize) > 0.001) {
          fillGate(gate.group, gate.gapSize);
        }
      }
    }
  }

  private updateTrail(color: THREE.Color, playerZ: number) {
    const i = this.trailHead;
    const jitter = LOW_POWER ? 0 : 0.3;
    const jx = jitter ? (Math.random() - 0.5) * jitter : 0;
    const jy = jitter ? (Math.random() - 0.5) * jitter : 0;
    this.trailPos[i * 3] = this.playerX + jx;
    this.trailPos[i * 3 + 1] = this.playerY + jy;
    this.trailPos[i * 3 + 2] = playerZ - 0.5;
    this.trailCol[i * 3] = color.r;
    this.trailCol[i * 3 + 1] = color.g;
    this.trailCol[i * 3 + 2] = color.b;

    this.trailHead = (this.trailHead + 1) % TRAIL_COUNT;

    const stride = LOW_POWER ? 3 : 2;
    const start = this.trailHead % stride;
    for (let j = start; j < TRAIL_COUNT; j += stride) {
      this.trailCol[j * 3] *= 0.94;
      this.trailCol[j * 3 + 1] *= 0.94;
      this.trailCol[j * 3 + 2] *= 0.94;
    }

    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.color.needsUpdate = true;
  }

  // ─── Render ──────────────────────────

  private render() {
    let camX = this.camLeanX;
    let camY = this.camLeanY;
    if (!REDUCE_MOTION && this.shakeAmount > 0.01) {
      camX += (Math.random() - 0.5) * this.shakeAmount;
      camY += (Math.random() - 0.5) * this.shakeAmount;
    }

    this.camera.position.set(camX, camY, this.cameraZ);
    // up-vector tilt induces roll; look at the tunnel axis ahead for parallax
    this.camera.up.set(Math.sin(this.camRoll), Math.cos(this.camRoll), 0);
    this.camera.lookAt(0, 0, this.cameraZ + 100);

    this.composer.render();
  }

  // ─── Death Sequence ──────────────────

  private deathAnim() {
    if (this.alive || this.tabHidden || this.gameOverShown) return;

    const t = Math.min((performance.now() - this.deathStart) / 750, 1);
    const ease = 1 - (1 - t) * (1 - t);

    // Hold at the point of impact; shake + shatter carry the moment.
    const shake = REDUCE_MOTION ? 0 : this.shakeAmount;
    this.camera.position.set(
      (Math.random() - 0.5) * shake,
      (Math.random() - 0.5) * shake,
      this.cameraZ,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, this.cameraZ + 100);
    this.shakeAmount *= 0.9;

    // Shatter the ship — swell, spin out and fade.
    const mat = this.playerMesh.material as THREE.MeshBasicMaterial;
    if (REDUCE_MOTION) {
      mat.opacity = 1 - ease;
    } else {
      this.playerMesh.scale.setScalar(1 + ease * 3);
      this.playerMesh.rotation.x += 0.45;
      this.playerMesh.rotation.y += 0.55;
      mat.opacity = 1 - ease;
    }

    // Vignette clamps in like a blackout.
    const vig = this.vignettePass.uniforms as any;
    vig.offset.value = 1.0 - ease * 0.4;
    vig.darkness.value = 1.5 + ease * 1.2;

    this.composer.render();

    if (t < 1) {
      this.deathAnimRaf = requestAnimationFrame(() => this.deathAnim());
    }
  }

  // ─── Ambient (Pre-game) ──────────────

  private ambientStart = 0;

  private renderAmbient() {
    if (this.tabHidden) return;
    if (this.alive && !this.paused) return;

    if (this.ambientStart === 0) this.ambientStart = performance.now();
    const elapsed = (performance.now() - this.ambientStart) / 1000;

    if (Math.abs(this.camera.fov - 75) > 0.02) {
      this.camera.fov = 75;
      this.camera.updateProjectionMatrix();
    }

    this.cameraZ = elapsed * 5;
    this.camera.position.z = this.cameraZ;

    const ringStart = Math.floor(this.cameraZ / RING_SPACING) * RING_SPACING;
    for (let i = 0; i < this.tunnelRings.length; i++) {
      this.tunnelRings[i].position.z = ringStart + i * RING_SPACING;
    }

    this.camera.position.x = Math.sin(elapsed * 0.3) * 3;
    this.camera.position.y = Math.cos(elapsed * 0.4) * 2;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, this.cameraZ + 100);

    for (const g of this.gates) g.group.visible = false;
    this.playerMesh.visible = false;

    lerpPalette(Math.sin(elapsed * 0.1) * 0.5 + 0.5, this.themeCol);
    for (const ring of this.tunnelRings) {
      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.color.copy(this.themeCol);
      mat.opacity = 0.25 + 0.15 * Math.sin(ring.position.z * 0.1);
    }

    this.starfield.position.z = this.cameraZ;
    this.composer.render();

    if ((!this.started || !this.alive) && !this.tabHidden) {
      this.ambientRaf = requestAnimationFrame(() => this.renderAmbient());
    }
  }

  // ─── Resize ──────────────────────────

  private onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_DPR));
    this.composer.setSize(innerWidth, innerHeight);
    if (USE_BLOOM) this.bloomPass.resolution.set(innerWidth, innerHeight);
  }
}

// ─── Init ──────────────────────────────────────────────────

const ui = new UI();
const game = new AbyssGame(ui);
game.init();
