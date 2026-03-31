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

const GATE_POOL = 20;
const GATE_SPACING = 30;
const GATE_INITIAL_GAP = Math.PI * 0.9;   // ~162° opening
const GATE_MIN_GAP = Math.PI * 0.26;      // ~47° opening
const GATE_GAP_SHRINK = 0.005;
const GATE_INNER_R = 1.3;                 // Safe center hole

const PLAYER_RADIUS = 0.4;
const PLAYER_MAX_R = 8.5;
const PLAYER_SMOOTH = 6;

const TRAIL_COUNT = 500;
const STAR_COUNT = 3000;

const SPEED_INIT = 28;
const SPEED_MAX = 130;
const SPEED_ACCEL = 0.35;

// ─── Color Palette ─────────────────────────────────────────

const PALETTE = [
  new THREE.Color(0x00e5ff),   // cyan
  new THREE.Color(0x6366f1),   // indigo
  new THREE.Color(0xc026d3),   // fuchsia
  new THREE.Color(0xf43f5e),   // rose
  new THREE.Color(0xfbbf24),   // amber
];

function lerpPalette(t: number): THREE.Color {
  t = Math.min(Math.max(t, 0), 1);
  const n = PALETTE.length - 1;
  const i = Math.min(Math.floor(t * n), n - 1);
  const f = t * n - i;
  return PALETTE[i].clone().lerp(PALETTE[i + 1], f);
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
  private drone: OscillatorNode | null = null;
  private drone2: OscillatorNode | null = null;

  init() {
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.2;
      this.master.connect(this.ctx.destination);
    } catch { /* audio unavailable */ }
  }

  resume() { this.ctx?.resume(); }

  startDrone() {
    if (!this.ctx || !this.master) return;
    this.stopDrone();

    const g1 = this.ctx.createGain();
    g1.gain.value = 0.1;
    g1.connect(this.master);
    this.drone = this.ctx.createOscillator();
    this.drone.type = 'sine';
    this.drone.frequency.value = 55;
    this.drone.connect(g1);
    this.drone.start();

    const g2 = this.ctx.createGain();
    g2.gain.value = 0.05;
    g2.connect(this.master);
    this.drone2 = this.ctx.createOscillator();
    this.drone2.type = 'sine';
    this.drone2.frequency.value = 82.5;
    this.drone2.connect(g2);
    this.drone2.start();
  }

  setDronePitch(t: number) {
    if (this.drone) this.drone.frequency.value = 55 + t * 60;
    if (this.drone2) this.drone2.frequency.value = 82.5 + t * 90;
  }

  playPass() {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 600 + Math.random() * 600;
    g.gain.setValueAtTime(0.12, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + 0.15);
  }

  playDeath() {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 1.2);
    g.gain.setValueAtTime(0.3, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.2);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + 1.2);
  }

  stopDrone() {
    try { this.drone?.stop(); } catch { /* ok */ }
    try { this.drone2?.stop(); } catch { /* ok */ }
    this.drone = null;
    this.drone2 = null;
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

function fillGate(group: THREE.Group, gapSize: number, color: THREE.Color) {
  // Clear old children
  for (let i = group.children.length - 1; i >= 0; i--) {
    const c = group.children[i];
    group.remove(c);
    if ((c as THREE.Mesh).geometry) {
      (c as THREE.Mesh).geometry.dispose();
      const mat = (c as THREE.Mesh).material;
      if (mat && 'dispose' in mat) (mat as THREE.Material).dispose();
    }
  }

  const barrierLen = TAU - gapSize;

  // Force-field concentric ring arcs (barrier)
  for (let r = GATE_INNER_R; r <= TUNNEL_RADIUS; r += 1.3) {
    const geo = new THREE.TorusGeometry(r, 0.04, 6, 48, barrierLen);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = gapSize / 2; // start barrier after half-gap
    group.add(mesh);
  }

  // Subtle fill disc behind rings
  const discGeo = new THREE.RingGeometry(GATE_INNER_R, TUNNEL_RADIUS, 64, 1, gapSize / 2, barrierLen);
  const discMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.1,
  });
  group.add(new THREE.Mesh(discGeo, discMat));

  // Bright gap-edge arcs (white — bloom will make these glow hard)
  const arcOuter = new THREE.TorusGeometry(TUNNEL_RADIUS * 0.9, 0.07, 6, 32, gapSize);
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const outerArc = new THREE.Mesh(arcOuter, whiteMat);
  outerArc.rotation.z = -gapSize / 2;
  group.add(outerArc);

  const arcInner = new THREE.TorusGeometry(GATE_INNER_R + 0.3, 0.05, 6, 24, gapSize);
  const innerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  const innerArc = new THREE.Mesh(arcInner, innerMat);
  innerArc.rotation.z = -gapSize / 2;
  group.add(innerArc);
}

// ─── UI Manager ────────────────────────────────────────────

class UI {
  private startScreen = document.getElementById('start-screen')!;
  private hud = document.getElementById('hud')!;
  private gameOver = document.getElementById('game-over')!;
  private scoreEl = document.getElementById('score')!;
  private depthEl = document.getElementById('depth')!;
  private finalScoreEl = document.getElementById('final-score')!;
  private bestScoreEl = document.getElementById('best-score')!;
  private startBtn = document.getElementById('start-btn')!;
  private retryBtn = document.getElementById('retry-btn')!;

  onStart: (() => void) | null = null;
  onRetry: (() => void) | null = null;

  constructor() {
    this.startBtn.addEventListener('click', () => this.onStart?.());
    this.retryBtn.addEventListener('click', () => this.onRetry?.());
  }

  showStart() {
    this.startScreen.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.gameOver.classList.add('hidden');
  }

  showHUD() {
    this.startScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.gameOver.classList.add('hidden');
  }

  showGameOver(score: number, best: number) {
    this.hud.classList.add('hidden');
    this.gameOver.classList.remove('hidden');
    this.finalScoreEl.textContent = String(score);
    this.bestScoreEl.textContent = `BEST: ${best}`;
  }

  updateScore(score: number) {
    this.scoreEl.textContent = String(score);
  }

  updateDepth(depth: number) {
    this.depthEl.textContent = `DEPTH ${Math.floor(depth)}m`;
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
  private colorProgress = 0;
  private shakeAmount = 0;
  private lastTime = 0;
  private ambientRaf = 0;

  // Input
  private pointerX = 0.5;
  private pointerY = 0.5;

  // Audio
  private audio = new AudioEngine();

  constructor(private ui: UI) {
    this.bestScore = parseInt(localStorage.getItem('abyss-best') || '0', 10);
  }

  init() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000008, 0.006);

    // Camera — looks in +Z direction
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 600);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, 100);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000008);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Post-processing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      2.0, 0.5, 0.1,
    );
    this.composer.addPass(this.bloomPass);

    this.chromaPass = new ShaderPass(ChromaShader as any);
    this.composer.addPass(this.chromaPass);

    this.composer.addPass(new ShaderPass(VignetteShader as any));

    // Build world
    this.buildTunnel();
    this.buildGates();
    this.buildPlayer();
    this.buildStarfield();
    this.buildTrail();

    // Audio
    this.audio.init();

    // Input
    this.setupInput(canvas);

    // Resize
    window.addEventListener('resize', () => this.onResize());

    // UI callbacks
    this.ui.onStart = () => this.start();
    this.ui.onRetry = () => this.restart();

    // Show start screen with ambient rotation
    this.ui.showStart();
    this.renderAmbient();
  }

  // ─── Build Methods ───────────────────

  private buildTunnel() {
    const col = lerpPalette(0);
    for (let i = 0; i < RING_COUNT; i++) {
      const geo = new THREE.TorusGeometry(TUNNEL_RADIUS, RING_TUBE, 8, 64);
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
    const col = lerpPalette(0);
    for (let i = 0; i < GATE_POOL; i++) {
      const group = new THREE.Group();
      fillGate(group, GATE_INITIAL_GAP, col);
      group.position.z = 60 + i * GATE_SPACING;
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
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
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

    // Initialize off-screen
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
    const update = (x: number, y: number) => {
      this.pointerX = x / innerWidth;
      this.pointerY = y / innerHeight;
    };
    canvas.addEventListener('pointermove', (e) => update(e.clientX, e.clientY));
    canvas.addEventListener('pointerdown', (e) => update(e.clientX, e.clientY));

    // Keyboard fallback (WASD/Arrows)
    const keys = new Set<string>();
    window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

    // Poll keys each frame
    const pollInterval = setInterval(() => {
      if (!this.alive) return;
      const step = 0.03;
      if (keys.has('a') || keys.has('arrowleft'))  this.pointerX = Math.max(0, this.pointerX - step);
      if (keys.has('d') || keys.has('arrowright')) this.pointerX = Math.min(1, this.pointerX + step);
      if (keys.has('w') || keys.has('arrowup'))    this.pointerY = Math.max(0, this.pointerY - step);
      if (keys.has('s') || keys.has('arrowdown'))  this.pointerY = Math.min(1, this.pointerY + step);
    }, 16);

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => clearInterval(pollInterval));
  }

  // ─── Game Flow ───────────────────────

  start() {
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
    this.colorProgress = 0;
    this.shakeAmount = 0;
    this.trailHead = 0;

    // Reset trail
    for (let i = 0; i < TRAIL_COUNT; i++) {
      this.trailPos[i * 3 + 2] = -9999;
      this.trailCol[i * 3] = 0;
      this.trailCol[i * 3 + 1] = 0;
      this.trailCol[i * 3 + 2] = 0;
    }

    // Reset tunnel rings
    for (let i = 0; i < this.tunnelRings.length; i++) {
      this.tunnelRings[i].position.z = i * RING_SPACING;
    }

    // Reset gates
    const col = lerpPalette(0);
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      g.z = 60 + i * GATE_SPACING;
      g.group.position.z = g.z;
      g.group.rotation.z = Math.random() * TAU;
      g.gapAngle = g.group.rotation.z;
      g.gapSize = GATE_INITIAL_GAP;
      g.passed = false;
      g.active = true;
      g.flashTimer = 0;
      g.group.visible = true;
      g.group.scale.setScalar(1);
      fillGate(g.group, GATE_INITIAL_GAP, col);
    }

    // Camera
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, 100);

    // Show player (hidden during ambient)
    this.playerMesh.visible = true;

    cancelAnimationFrame(this.ambientRaf);
    this.ui.showHUD();
    this.ui.updateScore(0);
    this.ui.updateDepth(0);

    this.lastTime = performance.now();
    this.gameLoop();
  }

  private die() {
    this.alive = false;
    this.audio.playDeath();
    this.audio.stopDrone();

    // Update best score
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      localStorage.setItem('abyss-best', String(this.bestScore));
    }

    // Brief delay before showing game over
    setTimeout(() => {
      this.ui.showGameOver(this.score, this.bestScore);
    }, 600);
  }

  private restart() {
    this.start();
  }

  // ─── Game Loop ───────────────────────

  private gameLoop() {
    if (!this.alive) return;

    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(dt, 0.05); // Cap to prevent physics explosion

    this.update(dt);
    this.render();

    requestAnimationFrame(() => this.gameLoop());
  }

  private update(dt: number) {
    // Speed ramp
    this.speed = Math.min(this.speed + SPEED_ACCEL * dt, SPEED_MAX);
    const speedT = (this.speed - SPEED_INIT) / (SPEED_MAX - SPEED_INIT);

    // Move camera forward
    this.prevZ = this.cameraZ;
    this.cameraZ += this.speed * dt;
    this.depth += this.speed * dt;

    this.camera.position.z = this.cameraZ;

    // Player input
    this.targetX = (this.pointerX - 0.5) * 2 * PLAYER_MAX_R;
    this.targetY = -(this.pointerY - 0.5) * 2 * PLAYER_MAX_R;

    // Smooth follow
    this.playerX += (this.targetX - this.playerX) * PLAYER_SMOOTH * dt;
    this.playerY += (this.targetY - this.playerY) * PLAYER_SMOOTH * dt;

    // Clamp to tunnel
    const dist = Math.sqrt(this.playerX ** 2 + this.playerY ** 2);
    if (dist > PLAYER_MAX_R) {
      this.playerX *= PLAYER_MAX_R / dist;
      this.playerY *= PLAYER_MAX_R / dist;
    }

    // Update player mesh
    const playerZ = this.cameraZ + 12;
    this.playerMesh.position.set(this.playerX, this.playerY, playerZ);
    this.playerMesh.rotation.x += dt * 2;
    this.playerMesh.rotation.y += dt * 3;

    // Color progression
    this.colorProgress = Math.min(this.score / 80, 1);
    const themeCol = lerpPalette(this.colorProgress);

    // Update player glow color
    this.playerGlow.color.copy(themeCol);

    // Screen shake decay
    this.shakeAmount *= 0.9;

    // Audio
    this.audio.setDronePitch(speedT);

    // Recycle tunnel rings
    this.recycleTunnel(themeCol);

    // Update and check gates
    this.updateGates(dt, themeCol, playerZ);

    // Update trail
    this.updateTrail(themeCol, playerZ);

    // Update starfield position (follows camera)
    this.starfield.position.z = this.cameraZ;

    // Update post-processing intensity based on speed
    (this.chromaPass.uniforms as any).amount.value = 0.002 + speedT * 0.008;
    this.bloomPass.strength = 1.8 + speedT * 1.2;

    // Fog density increases slightly
    (this.scene.fog as THREE.FogExp2).density = 0.006 + speedT * 0.003;

    // UI
    this.ui.updateScore(this.score);
    this.ui.updateDepth(this.depth);
  }

  private recycleTunnel(color: THREE.Color) {
    for (const ring of this.tunnelRings) {
      if (ring.position.z < this.cameraZ - 10) {
        // Find the furthest ring and place beyond it
        let maxZ = -Infinity;
        for (const r of this.tunnelRings) {
          if (r.position.z > maxZ) maxZ = r.position.z;
        }
        ring.position.z = maxZ + RING_SPACING;

        // Update color
        const mat = ring.material as THREE.MeshBasicMaterial;
        mat.color.copy(color);

        // Pulse effect — vary opacity by position
        const pulse = 0.25 + 0.15 * Math.sin(ring.position.z * 0.1);
        mat.opacity = pulse;
      }
    }
  }

  private updateGates(dt: number, color: THREE.Color, playerZ: number) {
    for (const gate of this.gates) {
      if (!gate.active) continue;

      // Flash animation (after pass)
      if (gate.flashTimer > 0) {
        gate.flashTimer -= dt;
        const t = Math.max(gate.flashTimer / 0.3, 0);
        gate.group.scale.setScalar(1 + (1 - t) * 0.15);
      }

      // Check if player passed through
      if (!gate.passed && this.prevZ + 12 < gate.z && this.cameraZ + 12 >= gate.z) {
        // Collision check
        const pAngle = Math.atan2(this.playerY, this.playerX);
        const gAngle = gate.gapAngle;
        let diff = pAngle - gAngle;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;

        const pDist = Math.sqrt(this.playerX ** 2 + this.playerY ** 2);
        const inGap = Math.abs(diff) < gate.gapSize / 2;
        const inCenter = pDist < GATE_INNER_R - PLAYER_RADIUS;

        if (inGap || inCenter) {
          // Passed safely!
          gate.passed = true;
          gate.flashTimer = 0.3;
          this.score++;
          this.audio.playPass();

          // Shrink gap for future gates
          this.gapSize = Math.max(this.gapSize - GATE_GAP_SHRINK, GATE_MIN_GAP);

          // Near-miss screen shake
          if (!inCenter) {
            const closeness = 1 - Math.abs(diff) / (gate.gapSize / 2);
            if (closeness > 0.6) {
              this.shakeAmount = closeness * 0.8;
            }
          }
        } else {
          // Hit!
          this.die();
          return;
        }
      }

      // Recycle gates that are behind the camera
      if (gate.z < this.cameraZ - 30) {
        // Find furthest gate
        let maxZ = -Infinity;
        for (const g of this.gates) {
          if (g.z > maxZ) maxZ = g.z;
        }
        gate.z = maxZ + GATE_SPACING;
        gate.group.position.z = gate.z;
        gate.group.rotation.z = Math.random() * TAU;
        gate.gapAngle = gate.group.rotation.z;
        gate.gapSize = this.gapSize;
        gate.passed = false;
        gate.flashTimer = 0;
        gate.group.scale.setScalar(1);
        fillGate(gate.group, this.gapSize, color);
      }
    }
  }

  private updateTrail(color: THREE.Color, playerZ: number) {
    // Spawn new trail particle
    const i = this.trailHead;
    this.trailPos[i * 3] = this.playerX + (Math.random() - 0.5) * 0.3;
    this.trailPos[i * 3 + 1] = this.playerY + (Math.random() - 0.5) * 0.3;
    this.trailPos[i * 3 + 2] = playerZ - 0.5;
    this.trailCol[i * 3] = color.r;
    this.trailCol[i * 3 + 1] = color.g;
    this.trailCol[i * 3 + 2] = color.b;

    this.trailHead = (this.trailHead + 1) % TRAIL_COUNT;

    // Fade all particles
    for (let j = 0; j < TRAIL_COUNT; j++) {
      this.trailCol[j * 3] *= 0.97;
      this.trailCol[j * 3 + 1] *= 0.97;
      this.trailCol[j * 3 + 2] *= 0.97;
    }

    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.color.needsUpdate = true;
  }

  // ─── Render ──────────────────────────

  private render() {
    // Screen shake
    if (this.shakeAmount > 0.01) {
      this.camera.position.x = (Math.random() - 0.5) * this.shakeAmount;
      this.camera.position.y = (Math.random() - 0.5) * this.shakeAmount;
    } else {
      this.camera.position.x = 0;
      this.camera.position.y = 0;
    }

    this.composer.render();
  }

  // ─── Ambient (Pre-game) ──────────────

  private renderAmbient() {
    const now = performance.now() / 1000;

    // Slow drift through tunnel
    this.cameraZ = now * 5;
    this.camera.position.z = this.cameraZ;

    // Gentle orbit
    this.camera.position.x = Math.sin(now * 0.3) * 3;
    this.camera.position.y = Math.cos(now * 0.4) * 2;

    // Hide gates during ambient
    for (const g of this.gates) g.group.visible = false;

    // Hide player
    this.playerMesh.visible = false;

    // Recycle tunnel rings
    this.recycleTunnel(lerpPalette(Math.sin(now * 0.1) * 0.5 + 0.5));

    // Move starfield
    this.starfield.position.z = this.cameraZ;

    this.composer.render();

    if (!this.started || !this.alive) {
      this.ambientRaf = requestAnimationFrame(() => this.renderAmbient());
    }
  }

  // ─── Resize ──────────────────────────

  private onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloomPass.resolution.set(innerWidth, innerHeight);
  }
}

// ─── Init ──────────────────────────────────────────────────

const ui = new UI();
const game = new AbyssGame(ui);
game.init();
