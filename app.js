import * as THREE from "three";

/* -------------------------------------------------------------------------- */
/*  Presentation state                                                        */
/* -------------------------------------------------------------------------- */

const slides = [...document.querySelectorAll(".slide")];
const deck = document.getElementById("deck");
const depthFill = document.getElementById("depthFill");
const depthMarker = document.getElementById("depthMarker");
const slideNum = document.getElementById("slideNum");
const slideTotal = document.getElementById("slideTotal");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const dotsEl = document.getElementById("dots");
const depthValue = document.querySelector(".depth-value");
const depthZone = document.querySelector(".depth-zone");
const fog = document.querySelector(".fog-overlay");

let index = 0;
let animDepth = 0;
let targetDepth = 0;
let reducingMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* -------------------------------------------------------------------------- */
/*  Performance tier — auto-detect weak GPUs / VDI, allow manual override      */
/* -------------------------------------------------------------------------- */
/* The scene is heavy (glass transmission passes, per-frame ocean normals, and */
/* backdrop-filter blur composited over a live canvas). That's fine on a fast  */
/* GPU but crawls on low-power / virtual displays. "Lite" mode swaps in cheaper */
/* materials, drops the pixel ratio, freezes the ocean wave, and disables the   */
/* CSS blur — keeping the experience smooth on modest hardware.                 */

const params = new URLSearchParams(location.search);

function readStoredPerf() {
  try {
    return localStorage.getItem("perfMode");
  } catch {
    return null;
  }
}

function detectLowEndDevice() {
  // Respect explicit user/URL choices first.
  if (params.has("lite") || params.get("perf") === "low") return true;
  if (params.get("perf") === "high") return false;
  const stored = readStoredPerf();
  if (stored === "lite") return true;
  if (stored === "high") return false;

  if (reducingMotion) return true;
  if (navigator.connection?.saveData) return true;

  // Only trust these when the browser actually reports them (Safari omits
  // deviceMemory, so we must not assume "low" from a missing value — that would
  // wrongly downgrade capable Macs). Keep the bar low to avoid false positives;
  // the runtime FPS monitor is the real safety net for weak/VDI GPUs.
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return true;
  if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;

  // Sniff the GPU string — software renderers and virtual GPUs (common on VDI)
  // can't keep up with the transmission/blur workload.
  try {
    const gl =
      document.createElement("canvas").getContext("webgl") ||
      document.createElement("canvas").getContext("experimental-webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
      if (/swiftshader|llvmpipe|software|basic render|virtualbox|vmware|virgl|microsoft basic|paravirtual/i.test(r)) {
        return true;
      }
    }
  } catch {
    /* ignore — fall through to default */
  }

  return false;
}

// Whether the user explicitly picked a tier (disables auto-downgrade heuristics).
let perfUserChoice = params.has("lite") || params.has("perf") || readStoredPerf() != null;
let perfLite = detectLowEndDevice();
document.body.classList.toggle("perf-lite", perfLite);

slideTotal.textContent = String(slides.length).padStart(2, "0");

slides.forEach((_, i) => {
  const b = document.createElement("button");
  b.className = "dot" + (i === 0 ? " active" : "");
  b.type = "button";
  b.setAttribute("aria-label", `Go to slide ${i + 1}`);
  b.addEventListener("click", () => goTo(i));
  dotsEl.appendChild(b);
});

const dots = [...dotsEl.querySelectorAll(".dot")];

function zoneFor(depth) {
  if (depth < 0.18) return "SURFACE";
  if (depth < 0.45) return "DEEP WEB";
  if (depth < 0.75) return "DARK WEB";
  return "ABYSS";
}

function metersFor(depth) {
  return Math.round(depth * 1100);
}

function restartSlideAnimations(slide) {
  const animated = slide.querySelectorAll(
    ".browser-live, .beat, .g-hit, .inbox-reveal, .tx, .tor-rescue, .danger-card, .myth-card, .rule, .pw-dots i, .lock-burst, .chrome-fail, .play-pulse, .door-panel, .shield-ring, .size-bar i"
  );
  animated.forEach((el) => {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  });

  const q = slide.querySelector(".typed-query");
  if (q) {
    const full = q.dataset.full || q.textContent.trim();
    q.dataset.full = full;
    q.textContent = "";
    let i = 0;
    const tick = () => {
      if (!slide.classList.contains("active")) return;
      q.textContent = full.slice(0, i);
      i += 1;
      if (i <= full.length) setTimeout(tick, 45);
    };
    setTimeout(tick, 400);
  }

  slide.querySelectorAll(".url-type").forEach((el) => {
    const full = el.dataset.type || "";
    el.textContent = "";
    let i = 0;
    const tick = () => {
      if (!slide.classList.contains("active")) return;
      el.textContent = full.slice(0, i);
      i += 1;
      if (i <= full.length) setTimeout(tick, 28);
    };
    setTimeout(tick, 200);
  });

  slide.querySelectorAll(".count-up").forEach((el) => {
    const target = Number(el.dataset.count || 0);
    const start = performance.now();
    const dur = 1400;
    const step = (now) => {
      if (!slide.classList.contains("active")) return;
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = `$${(target * eased).toFixed(2)}`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  // Myth cards: reset to "myth" side; one-time hint flip on the first card only.
  const mythCards = [...slide.querySelectorAll(".myth-card")];
  mythCards.forEach((card) => card.classList.remove("is-flipped"));
  const hintCard = mythCards[0];
  if (hintCard && !hintCard.dataset.userTapped) {
    setTimeout(() => {
      if (!slide.classList.contains("active") || hintCard.dataset.userTapped) return;
      hintCard.classList.add("is-flipped");
      setTimeout(() => {
        if (!slide.classList.contains("active") || hintCard.dataset.userTapped) return;
        hintCard.classList.remove("is-flipped");
      }, 1600);
    }, 800);
  }

  if (slide.querySelector("#threatFeed")) startThreatFeed(slide);
  if (slide.querySelector("#onionPeel")) startOnionPeel(slide);
}

/* -------------------------------------------------------------------------- */
/*  Live demos: Tor map hops, doors, myth flips, shield feed                  */
/* -------------------------------------------------------------------------- */

let threatTimer = null;

// Tor map: switch between "normal Google search" and "through Tor" routes
const torMap = document.getElementById("torMapDemo");
if (torMap) {
  const mapTabs = [...document.querySelectorAll(".map-tab")];
  mapTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.mode;
      torMap.classList.toggle("mode-tor", mode === "tor");
      torMap.classList.toggle("mode-normal", mode === "normal");
      mapTabs.forEach((t) => t.classList.toggle("active", t === tab));
    });
  });
}

let onionTimers = [];
function startOnionPeel(slide) {
  onionTimers.forEach(clearTimeout);
  onionTimers = [];
  const stack = slide.querySelector(".onion-stack");
  const title = slide.querySelector("#peelTitle");
  const text = slide.querySelector("#peelText");
  const steps = [...slide.querySelectorAll(".pstep")];
  const relays = [...slide.querySelectorAll(".relay-node")];
  if (!stack) return;

  const seq = [
    {
      cls: "peeled-1",
      title: "Entry relay peels layer 1",
      text: "The first relay removes the outer layer. It knows who you are — but not the site.",
    },
    {
      cls: "peeled-2",
      title: "Middle relay peels layer 2",
      text: "The middle relay peels the next layer. It only sees other relays — never you or the site.",
    },
    {
      cls: "peeled-3",
      title: "Exit relay peels layer 3 → message",
      text: "The exit relay removes the last layer and delivers your request. It sees the site — not your identity.",
    },
  ];

  const reset = () => {
    stack.className = "onion-stack";
    steps.forEach((s) => s.classList.remove("on", "done"));
    relays.forEach((r) => r.classList.remove("lit"));
    if (title) title.textContent = "Wrapped in 3 layers 🧅";
    if (text)
      text.textContent =
        "Your request is encrypted like an onion — each relay peels just one layer.";
  };

  const run = () => {
    if (!slide.classList.contains("active")) return;
    reset();
    seq.forEach((step, i) => {
      onionTimers.push(
        setTimeout(() => {
          if (!slide.classList.contains("active")) return;
          stack.classList.add(step.cls);
          if (title) title.textContent = step.title;
          if (text) text.textContent = step.text;
          steps.forEach((s, si) => {
            s.classList.toggle("on", si === i);
            if (si < i) s.classList.add("done");
          });
          relays.forEach((r, ri) => r.classList.toggle("lit", ri === i));
        }, 1300 + i * 1700)
      );
    });
    // finish: mark all done, then restart the loop
    onionTimers.push(
      setTimeout(() => {
        if (!slide.classList.contains("active")) return;
        steps.forEach((s) => {
          s.classList.remove("on");
          s.classList.add("done");
        });
        relays.forEach((r) => r.classList.remove("lit"));
      }, 1300 + seq.length * 1700)
    );
    onionTimers.push(setTimeout(run, 1300 + seq.length * 1700 + 2200));
  };
  run();
}

function startThreatFeed(slide) {
  clearInterval(threatTimer);
  const feed = slide.querySelector("#threatFeed");
  const counter = slide.querySelector("#blocksCount");
  if (!feed || !counter) return;
  feed.innerHTML = "";
  let blocks = 0;
  counter.textContent = "0";
  const threats = [
    "phishing link blocked",
    "fake airdrop ignored",
    "malware .exe stopped",
    "credential steal attempt",
    "doxx bait dismissed",
  ];
  let i = 0;
  const push = () => {
    if (!slide.classList.contains("active")) return;
    const row = document.createElement("div");
    row.className = "threat-item";
    row.textContent = threats[i % threats.length];
    feed.prepend(row);
    setTimeout(() => row.classList.add("blocked"), 350);
    while (feed.children.length > 3) feed.lastChild.remove();
    blocks += 1;
    counter.textContent = String(blocks);
    i += 1;
  };
  push();
  threatTimer = setInterval(push, 1600);
}

document.querySelectorAll(".myth-card").forEach((card) => {
  card.addEventListener("click", () => {
    card.dataset.userTapped = "1";
    card.classList.toggle("is-flipped");
  });
});

// Door choice → balance meter
const doorDemo = document.getElementById("doorDemo");
if (doorDemo) {
  const verdict = document.getElementById("scaleVerdict");
  const goodDoor = doorDemo.querySelector(".door.good");
  const badDoor = doorDemo.querySelector(".door.bad");

  const tip = (side) => {
    doorDemo.classList.toggle("tip-good", side === "good");
    doorDemo.classList.toggle("tip-bad", side === "bad");
    if (verdict) {
      verdict.textContent =
        side === "good"
          ? "Lawful privacy ✓"
          : side === "bad"
          ? "Still a crime ✕"
          : "Pick a door →";
    }
  };

  ["mouseenter", "focus", "click"].forEach((ev) => {
    goodDoor?.addEventListener(ev, () => tip("good"));
    badDoor?.addEventListener(ev, () => tip("bad"));
  });
  doorDemo.addEventListener("mouseleave", () => {
    if (!doorDemo.querySelector(".door:focus")) tip(null);
  });
}

// Safety checklist → live progress counter
const safetyChecklist = document.getElementById("safetyChecklist");
if (safetyChecklist) {
  const boxes = [...safetyChecklist.querySelectorAll('input[type="checkbox"]')];
  const progress = document.getElementById("checkProgress");
  const update = () => {
    const done = boxes.filter((b) => b.checked).length;
    if (!progress) return;
    if (done === boxes.length) {
      progress.textContent = "✓ All set — you're ready to stay safe!";
      progress.classList.add("done");
    } else {
      progress.textContent = `${done} / ${boxes.length} checked — tick each as you learn it`;
      progress.classList.remove("done");
    }
  };
  boxes.forEach((b) => b.addEventListener("change", update));
  update();
}

function goTo(next, dir) {
  if (next < 0 || next >= slides.length || next === index) return;
  const prev = slides[index];
  const incoming = slides[next];
  const direction = dir ?? (next > index ? 1 : -1);

  prev.classList.remove("active");
  prev.classList.add(direction > 0 ? "exit-up" : "exit-down");
  setTimeout(() => prev.classList.remove("exit-up", "exit-down"), 700);

  incoming.classList.add("active");
  index = next;

  targetDepth = Number(incoming.dataset.depth || 0);
  const theme = incoming.dataset.theme || "surface";
  document.body.dataset.theme = theme;

  slideNum.textContent = String(index + 1).padStart(2, "0");
  depthFill.style.width = `${targetDepth * 100}%`;
  depthMarker.style.left = `${targetDepth * 100}%`;
  depthZone.textContent = zoneFor(targetDepth);

  dots.forEach((d, i) => d.classList.toggle("active", i === index));
  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === slides.length - 1;

  updateFog(theme);
  restartSlideAnimations(incoming);
}

function updateFog(theme) {
  const maps = {
    surface:
      "radial-gradient(ellipse 80% 55% at 50% 100%, rgba(80,160,200,0.28), transparent 55%), linear-gradient(180deg, rgba(180,230,255,0.12) 0%, transparent 30%, rgba(1,4,12,0.4) 100%)",
    deep:
      "radial-gradient(ellipse 70% 50% at 50% 80%, rgba(20,90,130,0.4), transparent 55%), linear-gradient(180deg, rgba(2,20,40,0.45) 0%, transparent 35%, rgba(1,4,12,0.65) 100%)",
    dark:
      "radial-gradient(ellipse 60% 45% at 50% 70%, rgba(10,50,90,0.5), transparent 50%), linear-gradient(180deg, rgba(0,8,20,0.55) 0%, transparent 40%, rgba(0,2,8,0.75) 100%)",
    danger:
      "radial-gradient(ellipse 70% 50% at 50% 70%, rgba(90,20,20,0.45), transparent 55%), linear-gradient(180deg, rgba(40,8,8,0.55) 0%, transparent 40%, rgba(0,0,0,0.8) 100%)",
    abyss:
      "radial-gradient(ellipse 50% 40% at 50% 60%, rgba(5,30,60,0.55), transparent 45%), linear-gradient(180deg, rgba(0,4,12,0.7) 0%, transparent 45%, rgba(0,0,0,0.85) 100%)",
  };
  fog.style.background = maps[theme] || maps.surface;
}

prevBtn.addEventListener("click", () => goTo(index - 1, -1));
nextBtn.addEventListener("click", () => goTo(index + 1, 1));

document.querySelectorAll("[data-next]").forEach((el) => {
  el.addEventListener("click", () => goTo(index + 1, 1));
});

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
    e.preventDefault();
    goTo(index + 1, 1);
  } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
    e.preventDefault();
    goTo(index - 1, -1);
  } else if (e.key === "Home") {
    goTo(0, -1);
  } else if (e.key === "End") {
    goTo(slides.length - 1, 1);
  }
});

let wheelLock = false;
window.addEventListener(
  "wheel",
  (e) => {
    if (wheelLock) return;
    if (Math.abs(e.deltaY) < 28) return;
    wheelLock = true;
    goTo(index + (e.deltaY > 0 ? 1 : -1), e.deltaY > 0 ? 1 : -1);
    setTimeout(() => {
      wheelLock = false;
    }, 700);
  },
  { passive: true }
);

let touchY = null;
window.addEventListener(
  "touchstart",
  (e) => {
    touchY = e.touches[0].clientY;
  },
  { passive: true }
);
window.addEventListener(
  "touchend",
  (e) => {
    if (touchY == null) return;
    const dy = touchY - e.changedTouches[0].clientY;
    if (Math.abs(dy) > 50) goTo(index + (dy > 0 ? 1 : -1), dy > 0 ? 1 : -1);
    touchY = null;
  },
  { passive: true }
);

// Bootstrap first slide (goTo no-ops when index unchanged)
updateFog(slides[0].dataset.theme || "surface");
restartSlideAnimations(slides[0]);
prevBtn.disabled = true;
depthFill.style.width = "0%";
depthMarker.style.left = "0%";

// Hero title sci-fi glitch cycle: Iceberg → Deep Web → Dark Web → Tor Browser → …
const heroGlitch = document.getElementById("heroGlitch");
if (heroGlitch) {
  const words = ["Deep Web", "Dark Web", "Tor Browser", "Iceberg"];
  let wi = 0;
  const glitchTo = (word) => {
    heroGlitch.classList.add("glitching");
    setTimeout(() => {
      heroGlitch.textContent = word;
      heroGlitch.dataset.text = word;
    }, 260);
    setTimeout(() => heroGlitch.classList.remove("glitching"), 620);
  };
  const cycle = () => {
    glitchTo(words[wi]);
    wi = (wi + 1) % words.length;
    setTimeout(cycle, 2600);
  };
  setTimeout(cycle, 2000);
}

/* -------------------------------------------------------------------------- */
/*  Quiz                                                                      */
/* -------------------------------------------------------------------------- */

const QUESTIONS = [
  {
    q: "You searched for pizza on Google. Which layer was that?",
    options: ["Dark Web", "Surface Web", "Deep Web", "Tor-only zone"],
    answer: 1,
    explain: "Public searchable pages like Google results are the Surface Web tip.",
  },
  {
    q: "You logged into SecureMail and NorthStar Bank. That’s…",
    options: ["Surface Web", "Deep Web", "Dark Web", "Illegal by default"],
    answer: 1,
    explain: "Password-walled private pages are Deep Web — huge and everyday.",
  },
  {
    q: "Chrome couldn’t open examplepedia.onion for you. Why?",
    options: [
      "The site is always broken",
      ".onion needs special software like Tor",
      "Your Wi‑Fi was off",
      "Onion sites are just Deep Web logins",
    ],
    answer: 1,
    explain: "Dark Web hidden services usually need Tor (or similar) — normal browsers fail.",
  },
  {
    q: "Which trap almost got you in the danger animations?",
    options: [
      "A free crypto airdrop button",
      "A Wikipedia article",
      "Your StreamFlix homepage",
      "Campus tuition email",
    ],
    answer: 0,
    explain: "Too-good-to-be-true giveaways are classic scam bait — stamp blocked the click.",
  },
  {
    q: "Your big takeaway about Tor is…",
    options: [
      "It makes crime legal",
      "It guarantees perfect invisibility forever",
      "It adds privacy layers — laws still apply",
      "It replaces your bank password",
    ],
    answer: 2,
    explain: "Tor helps privacy. Mistakes still matter, and illegal stays illegal.",
  },
];

const quizCard = document.getElementById("quizCard");
const quizResult = document.getElementById("quizResult");
const quizBar = document.getElementById("quizBar");

let qIndex = 0;
let score = 0;
let locked = false;

function renderQuestion() {
  locked = false;
  const item = QUESTIONS[qIndex];
  quizBar.style.width = `${(qIndex / QUESTIONS.length) * 100}%`;
  quizCard.innerHTML = `
    <div class="q-meta">Question ${qIndex + 1} of ${QUESTIONS.length}</div>
    <div class="q-text">${item.q}</div>
    <div class="options">
      ${item.options
        .map(
          (opt, i) =>
            `<button class="option" type="button" data-i="${i}">${opt}</button>`
        )
        .join("")}
    </div>
    <div class="feedback" id="feedback"></div>
    <div class="quiz-actions" id="quizActions"></div>
  `;

  quizCard.querySelectorAll(".option").forEach((btn) => {
    btn.addEventListener("click", () => pick(Number(btn.dataset.i)));
  });
}

function pick(i) {
  if (locked) return;
  locked = true;
  const item = QUESTIONS[qIndex];
  const buttons = [...quizCard.querySelectorAll(".option")];
  buttons.forEach((b) => {
    b.disabled = true;
    const bi = Number(b.dataset.i);
    if (bi === item.answer) b.classList.add("correct");
    if (bi === i && i !== item.answer) b.classList.add("wrong");
  });

  if (i === item.answer) score += 1;
  document.getElementById("feedback").textContent = item.explain;

  const actions = document.getElementById("quizActions");
  const next = document.createElement("button");
  next.className = "btn primary";
  next.type = "button";
  next.textContent = qIndex === QUESTIONS.length - 1 ? "See results" : "Next question →";
  next.addEventListener("click", () => {
    qIndex += 1;
    if (qIndex >= QUESTIONS.length) showResults();
    else renderQuestion();
  });
  actions.appendChild(next);
}

function showResults() {
  quizBar.style.width = "100%";
  quizCard.classList.add("hidden");
  quizCard.style.display = "none";
  quizResult.classList.remove("hidden");
  const pct = Math.round((score / QUESTIONS.length) * 100);
  let title = "Surface skimmer";
  let blurb = "Nice start — replay your dive and watch the website demos again.";
  if (score >= 4) {
    title = "Iceberg navigator";
    blurb = "You can narrate Surface → Deep → Dark and spot the scam traps. Certified.";
  } else if (score >= 3) {
    title = "Deep explorer";
    blurb = "Solid grasp of your inbox, bank, and why .onion needs Tor.";
  }

  quizResult.innerHTML = `
    <div class="score-ring" style="--score:${pct}"><strong>${score}/${QUESTIONS.length}</strong></div>
    <h3>${title}</h3>
    <p>${blurb}</p>
    <button class="btn primary" type="button" id="retryQuiz">Try quiz again</button>
  `;
  document.getElementById("retryQuiz").addEventListener("click", () => {
    score = 0;
    qIndex = 0;
    quizResult.classList.add("hidden");
    quizCard.style.display = "";
    quizCard.classList.remove("hidden");
    renderQuestion();
  });
}

renderQuestion();

/* -------------------------------------------------------------------------- */
/*  Three.js — procedural iceberg + ocean abyss                               */
/* -------------------------------------------------------------------------- */

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  // Antialias is fixed at creation time; skip it on low-end/lite for a big win.
  antialias: !reducingMotion && !perfLite,
  alpha: true,
  powerPreference: perfLite ? "low-power" : "high-performance",
});

function pixelRatioFor(lite) {
  return Math.min(window.devicePixelRatio, lite || reducingMotion ? 1 : 1.75);
}
renderer.setPixelRatio(pixelRatioFor(perfLite));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x020814, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04101c, 0.018);

const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 4.5, 14);

const hemi = new THREE.HemisphereLight(0xb8e8ff, 0x061018, 0.85);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xdff7ff, 1.35);
key.position.set(6, 12, 4);
scene.add(key);

const rim = new THREE.DirectionalLight(0x3ecbff, 0.55);
rim.position.set(-8, 2, -6);
scene.add(rim);

const abyssLight = new THREE.PointLight(0x1a6a9a, 1.2, 40);
abyssLight.position.set(0, -8, 2);
scene.add(abyssLight);

/* Ocean plane — fewer segments in lite mode (the wave loop scales with them) */
const oceanSegments = perfLite ? 24 : 64;
const oceanGeo = new THREE.PlaneGeometry(80, 80, oceanSegments, oceanSegments);
const oceanMat = new THREE.MeshStandardMaterial({
  color: 0x0a3048,
  metalness: 0.2,
  roughness: 0.35,
  transparent: true,
  opacity: 0.72,
});
const ocean = new THREE.Mesh(oceanGeo, oceanMat);
ocean.rotation.x = -Math.PI / 2;
ocean.position.y = 0;
scene.add(ocean);

/* Iceberg group — procedural low-poly sculpture */
const iceberg = new THREE.Group();
scene.add(iceberg);

function iceMaterial(opts = {}, lite = perfLite) {
  // Lite: MeshStandardMaterial has no transmission pass, so the whole scene
  // isn't re-rendered into an offscreen buffer every frame. Still reads as ice.
  if (lite) {
    return new THREE.MeshStandardMaterial({
      color: opts.color ?? 0xc9f0ff,
      metalness: 0.0,
      roughness: 0.45,
      transparent: true,
      opacity: Math.min(1, (opts.opacity ?? 0.92) + 0.04),
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0xc9f0ff,
    metalness: 0.05,
    roughness: 0.22,
    transmission: opts.transmission ?? 0.35,
    thickness: opts.thickness ?? 1.4,
    ior: 1.31,
    transparent: true,
    opacity: opts.opacity ?? 0.92,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    envMapIntensity: 1,
  });
}

const ICE_MAT_SPECS = {
  tip: { color: 0xe8fbff, transmission: 0.45, opacity: 0.95 },
  body: { color: 0x9fd8ef, transmission: 0.28, opacity: 0.9 },
  deep: { color: 0x4a8eae, transmission: 0.15, opacity: 0.88, thickness: 2.2 },
};

function buildIceMaterials(lite) {
  return {
    tip: iceMaterial(ICE_MAT_SPECS.tip, lite),
    body: iceMaterial(ICE_MAT_SPECS.body, lite),
    deep: iceMaterial(ICE_MAT_SPECS.deep, lite),
  };
}

function makeCraggyMesh(radius, detail, stretchY, mat) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 2.1 + z * 1.7) * 0.12 +
      Math.cos(y * 3.3 + x * 0.8) * 0.1 +
      Math.sin((x + y + z) * 1.9) * 0.08;
    pos.setXYZ(i, x * (1 + n), y * stretchY * (1 + n * 0.6), z * (1 + n));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

let iceMats = buildIceMaterials(perfLite);

const tip = makeCraggyMesh(1.35, 2, 1.35, iceMats.tip);
tip.position.y = 1.55;
iceberg.add(tip);

const mid = makeCraggyMesh(2.4, 2, 0.85, iceMats.body);
mid.position.y = -0.2;
iceberg.add(mid);

const base = makeCraggyMesh(3.3, 1, 1.1, iceMats.deep);
base.position.y = -3.4;
iceberg.add(base);

const keel = makeCraggyMesh(2.1, 1, 1.4, iceMats.deep);
keel.position.y = -6.2;
keel.scale.set(0.85, 1, 0.85);
iceberg.add(keel);

/* Waterline ring */
const ringGeo = new THREE.TorusGeometry(3.6, 0.04, 8, 64);
const ringMat = new THREE.MeshBasicMaterial({
  color: 0xa8e8ff,
  transparent: true,
  opacity: 0.55,
});
const waterline = new THREE.Mesh(ringGeo, ringMat);
waterline.rotation.x = Math.PI / 2;
waterline.position.y = 0.02;
iceberg.add(waterline);

/* Bubbles / particles */
const particleCount = reducingMotion || perfLite ? 80 : 220;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(particleCount * 3);
const pSpeed = new Float32Array(particleCount);
for (let i = 0; i < particleCount; i++) {
  pPos[i * 3] = (Math.random() - 0.5) * 28;
  pPos[i * 3 + 1] = Math.random() * -18;
  pPos[i * 3 + 2] = (Math.random() - 0.5) * 28;
  pSpeed[i] = 0.2 + Math.random() * 0.55;
}
pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
const particles = new THREE.Points(
  pGeo,
  new THREE.PointsMaterial({
    color: 0xb8f0ff,
    size: 0.08,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
);
scene.add(particles);

/* Soft caustic plane under water */
const caustic = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshBasicMaterial({
    color: 0x3ecbff,
    transparent: true,
    opacity: 0.04,
    side: THREE.DoubleSide,
  })
);
caustic.rotation.x = Math.PI / 2;
caustic.position.y = -9;
scene.add(caustic);

/* Stars / snow above surface */
const starCount = reducingMotion || perfLite ? 40 : 120;
const sGeo = new THREE.BufferGeometry();
const sPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  sPos[i * 3] = (Math.random() - 0.5) * 40;
  sPos[i * 3 + 1] = 2 + Math.random() * 16;
  sPos[i * 3 + 2] = (Math.random() - 0.5) * 40;
}
sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
const stars = new THREE.Points(
  sGeo,
  new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.05,
    transparent: true,
    opacity: 0.65,
  })
);
scene.add(stars);

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", onResize);

/* -------------------------------------------------------------------------- */
/*  Quality switching (manual toggle + automatic FPS-based downgrade)          */
/* -------------------------------------------------------------------------- */

const perfToggle = document.getElementById("perfToggle");

function updatePerfButton() {
  if (!perfToggle) return;
  perfToggle.setAttribute("aria-pressed", String(perfLite));
  perfToggle.classList.toggle("on", perfLite);
  perfToggle.textContent = perfLite ? "Lite mode: on" : "Lite mode: off";
}

function applyQuality(lite, { persist = true } = {}) {
  if (lite === perfLite) {
    updatePerfButton();
    return;
  }
  perfLite = lite;
  document.body.classList.toggle("perf-lite", lite);
  renderer.setPixelRatio(pixelRatioFor(lite));

  // Swap the iceberg materials (transmission on/off is the big GPU lever).
  const next = buildIceMaterials(lite);
  [tip.material, mid.material, base.material, keel.material].forEach((m) => {
    if (m && m !== next.tip && m !== next.body && m !== next.deep) m.dispose();
  });
  iceMats = next;
  tip.material = next.tip;
  mid.material = next.body;
  base.material = next.deep;
  keel.material = next.deep;

  if (persist) {
    try {
      localStorage.setItem("perfMode", lite ? "lite" : "high");
    } catch {
      /* storage unavailable — ignore */
    }
  }
  updatePerfButton();
}

if (perfToggle) {
  perfToggle.addEventListener("click", () => {
    perfUserChoice = true;
    applyQuality(!perfLite, { persist: true });
  });
}
updatePerfButton();

// Auto-downgrade: if we sustain a low frame rate in high mode (and the user
// hasn't chosen a tier), quietly drop to lite so the dive stays smooth.
let fpsFrames = 0;
let fpsWindowStart = performance.now();
let lowFpsStreak = 0;

function trackFps(now) {
  fpsFrames += 1;
  const elapsed = now - fpsWindowStart;
  if (elapsed < 1000) return;
  const fps = (fpsFrames * 1000) / elapsed;
  fpsFrames = 0;
  fpsWindowStart = now;
  if (perfLite || perfUserChoice) return;
  if (fps < 24) {
    lowFpsStreak += 1;
    if (lowFpsStreak >= 3) applyQuality(true, { persist: false });
  } else {
    lowFpsStreak = 0;
  }
}

const clock = new THREE.Clock();
let pointerX = 0;
let pointerY = 0;
window.addEventListener(
  "pointermove",
  (e) => {
    pointerX = (e.clientX / window.innerWidth) * 2 - 1;
    pointerY = (e.clientY / window.innerHeight) * 2 - 1;
  },
  { passive: true }
);

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const dt = Math.min(clock.getDelta(), 0.05);

  animDepth += (targetDepth - animDepth) * (reducingMotion ? 1 : 0.045);

  // Dive: camera sinks; iceberg rises relative to view
  const camY = THREE.MathUtils.lerp(4.8, -7.5, animDepth);
  const camZ = THREE.MathUtils.lerp(14, 11, animDepth);
  const lookY = THREE.MathUtils.lerp(0.6, -4.5, animDepth);

  camera.position.x = THREE.MathUtils.lerp(camera.position.x, pointerX * 1.2, 0.04);
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, camY + pointerY * -0.4, 0.06);
  camera.position.z = THREE.MathUtils.lerp(camera.position.z, camZ, 0.06);
  camera.lookAt(pointerX * 0.4, lookY, 0);

  iceberg.rotation.y = t * 0.08 + pointerX * 0.15;
  iceberg.rotation.z = Math.sin(t * 0.35) * 0.03;
  tip.position.y = 1.55 + Math.sin(t * 0.9) * 0.05;

  ocean.material.opacity = THREE.MathUtils.lerp(0.55, 0.2, animDepth);
  waterline.material.opacity = THREE.MathUtils.lerp(0.55, 0.15, animDepth);
  abyssLight.intensity = THREE.MathUtils.lerp(0.4, 1.8, animDepth);
  scene.fog.density = THREE.MathUtils.lerp(0.012, 0.028, animDepth);
  scene.fog.color.setHSL(0.55, 0.45, THREE.MathUtils.lerp(0.08, 0.03, animDepth));
  renderer.setClearColor(
    new THREE.Color().setHSL(0.58, 0.55, THREE.MathUtils.lerp(0.06, 0.015, animDepth)),
    1
  );

  // Gentle ocean vertex wave — the per-vertex loop + normal recompute is the
  // single most expensive CPU cost per frame, so it's frozen in lite mode.
  if (!reducingMotion && !perfLite) {
    const pos = ocean.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const wave =
        Math.sin(x * 0.35 + t * 1.2) * 0.12 + Math.cos(y * 0.28 + t * 0.9) * 0.08;
      pos.setZ(i, wave);
    }
    pos.needsUpdate = true;
    ocean.geometry.computeVertexNormals();
  }

  // Bubbles rise
  const arr = particles.geometry.attributes.position.array;
  for (let i = 0; i < particleCount; i++) {
    arr[i * 3 + 1] += pSpeed[i] * dt * (0.6 + animDepth);
    if (arr[i * 3 + 1] > 1.5) {
      arr[i * 3 + 1] = -16 - Math.random() * 4;
      arr[i * 3] = (Math.random() - 0.5) * 28;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 28;
    }
  }
  particles.geometry.attributes.position.needsUpdate = true;
  particles.rotation.y = t * 0.02;

  caustic.material.opacity = 0.03 + Math.sin(t * 0.7) * 0.015 + animDepth * 0.02;
  caustic.rotation.z = t * 0.05;

  depthValue.textContent = `${metersFor(animDepth)}m`;

  renderer.render(scene, camera);
  trackFps(performance.now());
}

animate();
