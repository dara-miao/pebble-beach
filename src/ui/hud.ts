import type { CourseData, HoleData, TeeSet, CameraMode, Vec2 } from "../course/types";
import type { Lie } from "../shot/lie";
import { clubForYards } from "../shot/parse";

export interface HudState {
  hole: number;
  tee: TeeSet;
  camera: CameraMode;
}

export interface ShotHudInfo {
  summary?: string;
  outcome?: string;
  carry?: number;
  total?: number;
  peak?: number;
  leftover?: number;
  landLie?: string;
  kind?: "preview" | "result";
}

export interface PlayHudView {
  strokes: number;
  penalties: number;
  lie: Lie;
  lieLabel: string;
  remainingYards: number;
  pinYards: number;
  holed: boolean;
  onTee: boolean;
  ball: Vec2;
}

export interface HudHandlers {
  onChange: (next: Partial<HudState>) => void;
  onShot: (prompt: string) => void;
  onPreview: (prompt: string) => void;
  onReset: () => void;
}

const TEE_LABELS: Record<TeeSet, string> = {
  championship: "Champ",
  blue: "Blue",
  gold: "Gold",
  white: "White",
};

const TEE_ORDER: TeeSet[] = ["championship", "blue", "gold", "white"];

export function renderHud(
  el: HTMLElement,
  course: CourseData,
  hole: HoleData,
  state: HudState,
  play: PlayHudView,
  handlers: HudHandlers,
  shot?: ShotHudInfo,
  draft = "",
): void {
  const yards = hole.yards[state.tee];
  const bunkers = hole.bunkers.slice(0, 5);
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);
  const teeName = course.scorecard[state.tee]?.name ?? TEE_LABELS[state.tee];
  const chips = shotChips(play);
  const placeholder = shotPlaceholder(play);

  el.innerHTML = `
    <div class="panel brand">
      <p class="kicker">${course.location}</p>
      <h1>${course.name}</h1>
      <div class="meta">
        <span>Par ${course.par}</span>
        <span class="dot"></span>
        <span>${course.scorecard[state.tee].total.toLocaleString()} yds</span>
        <span class="dot"></span>
        <span>${teeName}</span>
      </div>
    </div>

    <div class="panel hole">
      <div class="hole-head">
        <div class="hole-num">
          <span>Hole</span>
          <strong>${hole.number}</strong>
        </div>
        <div class="stats">
          <div><em>Par</em><b>${hole.par}</b></div>
          <div><em>Yards</em><b>${yards}</b></div>
          <div><em>HCP</em><b>${hole.handicap}</b></div>
        </div>
      </div>
      <p class="note">${hole.note}</p>
      <div class="play-status">
        <div class="play-stat">
          <em>Now</em>
          <b>${play.holed ? `Holed in ${play.strokes}` : `Shot ${play.strokes + 1}`}</b>
        </div>
        <div class="play-stat">
          <em>Lie</em>
          <b class="lie-badge lie-${play.lie}">${play.lieLabel}</b>
        </div>
        <div class="play-stat">
          <em>Left</em>
          <b>${play.holed ? "—" : `${Math.round(play.remainingYards)}`}</b>
        </div>
      </div>
    </div>

    <nav class="holes">
      ${holes
        .map(
          (n) =>
            `<button type="button" class="${n === hole.number ? "on" : ""}" data-hole="${n}">${n}</button>`,
        )
        .join("")}
    </nav>

    <div class="panel controls">
      <div class="control-block">
        <span class="label">Tees</span>
        <div class="seg tee-seg">
          ${TEE_ORDER.map(
            (t) =>
              `<button type="button" data-tee="${t}" class="tee-${t} ${state.tee === t ? "on" : ""}">${TEE_LABELS[t]}</button>`,
          ).join("")}
        </div>
      </div>
      <div class="control-block">
        <span class="label">Camera</span>
        <div class="seg">
          <button type="button" data-cam="tee" class="${state.camera === "tee" ? "on" : ""}">${play.onTee ? "Tee" : "Ball"}</button>
          <button type="button" data-cam="flyover" class="${state.camera === "flyover" ? "on" : ""}">Flyover</button>
          <button type="button" data-cam="green" class="${state.camera === "green" ? "on" : ""}">Green</button>
          <button type="button" data-cam="overview" class="${state.camera === "overview" ? "on" : ""}">Course</button>
        </div>
      </div>
    </div>

    <div class="panel shot">
      <div class="shot-head">
        <h2>Call your shot</h2>
        <button type="button" class="reset" data-reset>Reset hole</button>
      </div>
      <form class="shot-form">
        <input
          name="prompt"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="${placeholder}"
          value="${escapeAttr(draft)}"
          ${play.holed ? "disabled" : ""}
        />
        <button type="submit" ${play.holed ? "disabled" : ""}>Hit</button>
      </form>
      <div class="chips">
        ${chips
          .map((c) => `<button type="button" data-ex="${escapeAttr(c.prompt)}">${c.label}</button>`)
          .join("")}
      </div>
      <div class="shot-panel">${shotPanelHtml(shot, play)}</div>
    </div>

    <div class="panel book">
      <div class="book-head">
        <h2>Yardage book</h2>
      </div>
      <canvas class="mini" width="340" height="140"></canvas>
      <ul>
        <li><span>Scorecard</span><b>${yards} yds</b></li>
        <li><span>To pin</span><b>${play.holed ? "Holed" : `${Math.round(play.pinYards)} yds`}</b></li>
        <li><span>Ball lie</span><b>${play.lieLabel}</b></li>
        ${
          play.penalties
            ? `<li><span>Penalties</span><b>${play.penalties}</b></li>`
            : ""
        }
        ${bunkers
          .map(
            (b) =>
              `<li><span>Bunker ${b.side} at ${Math.round(b.yardsFromTee)}</span><b>${Math.round(b.yardsToGreen)} to green</b></li>`,
          )
          .join("")}
        ${hole.bunkers.length === 0 ? "<li><span>No mapped bunkers</span><b>-</b></li>" : ""}
      </ul>
    </div>

    <p class="hint">Type a shot to preview flight · Hit to play it · r resets the hole · arrows change holes</p>
  `;

  el.querySelectorAll<HTMLButtonElement>("[data-hole]").forEach((btn) => {
    btn.onclick = () => handlers.onChange({ hole: Number(btn.dataset.hole) });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-tee]").forEach((btn) => {
    btn.onclick = () => handlers.onChange({ tee: btn.dataset.tee as TeeSet });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-cam]").forEach((btn) => {
    btn.onclick = () => handlers.onChange({ camera: btn.dataset.cam as CameraMode });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-ex]").forEach((btn) => {
    btn.onclick = () => {
      const value = btn.dataset.ex ?? "";
      const input = el.querySelector<HTMLInputElement>("input[name=prompt]");
      if (input) input.value = value;
      handlers.onPreview(value);
    };
  });
  el.querySelector<HTMLButtonElement>("[data-reset]")!.onclick = () => handlers.onReset();

  const form = el.querySelector<HTMLFormElement>(".shot-form");
  const input = el.querySelector<HTMLInputElement>("input[name=prompt]");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input?.value.trim();
    if (value) handlers.onShot(value);
  });
  input?.addEventListener("input", () => {
    handlers.onPreview(input.value);
  });

  const mini = el.querySelector<HTMLCanvasElement>(".mini");
  if (mini) drawMinimap(mini, hole, play.ball, shot);
}

export function updateShotPanel(
  el: HTMLElement,
  play: PlayHudView,
  hole: HoleData,
  shot?: ShotHudInfo,
): void {
  const panel = el.querySelector(".shot-panel");
  if (panel) panel.innerHTML = shotPanelHtml(shot, play);
  const mini = el.querySelector<HTMLCanvasElement>(".mini");
  if (mini) drawMinimap(mini, hole, play.ball, shot);
  const left = el.querySelector(".play-status .play-stat:nth-child(3) b");
  if (left) left.textContent = play.holed ? "—" : `${Math.round(play.remainingYards)}`;
}

function shotPanelHtml(shot: ShotHudInfo | undefined, play: PlayHudView): string {
  if (play.holed) {
    return `<p class="idle">Holed out in ${play.strokes}${play.penalties ? ` (${play.penalties} penalty)` : ""}. Reset the hole to play it again.</p>`;
  }
  if (!shot?.outcome) {
    return `<p class="idle">Type a club and yards. Preview shows carry, land, and leftover from this lie — Hit keeps the ball there.</p>`;
  }
  const kind = shot.kind === "preview" ? "preview" : "result";
  const label = kind === "preview" ? "Preview" : "Result";
  return `<div class="result ${kind}">
    <p class="summary">${label} · ${shot.summary ?? ""}</p>
    <p class="outcome">${shot.outcome}</p>
    <div class="nums four">
      <div><em>Carry</em><b>${shot.carry}</b></div>
      <div><em>Total</em><b>${shot.total}</b></div>
      <div><em>Peak</em><b>${shot.peak}<small>y</small></b></div>
      <div><em>Left</em><b>${shot.leftover}</b></div>
    </div>
  </div>`;
}

function shotChips(play: PlayHudView): { label: string; prompt: string }[] {
  if (play.holed) return [];
  const left = Math.max(8, Math.round(play.remainingYards));
  if (play.lie === "ocean") {
    return [
      { label: "pw after drop", prompt: "pw 80" },
      { label: "7i after drop", prompt: "7 iron 140" },
    ];
  }
  if (play.lie === "bunker" || play.lie === "sand") {
    return [
      { label: "sw splash 35", prompt: "sw 35" },
      { label: "lw 20", prompt: "lw 20" },
    ];
  }
  if (play.lie === "green" || left <= 18) {
    return [
      { label: `putt ${left}`, prompt: `putt ${left}` },
      { label: "lag putt", prompt: `putt ${Math.max(6, Math.round(left * 0.8))}` },
    ];
  }
  if (play.lie === "woods") {
    return [
      { label: "punch 7i", prompt: "7 iron 120" },
      { label: "punch 8i", prompt: "8 iron 90" },
    ];
  }
  const club = clubForYards(left);
  return [
    { label: `${club} ${left}`, prompt: `${club} ${left}` },
    { label: `${club} draw`, prompt: `${club} ${left} draw` },
    { label: `${club} fade`, prompt: `${club} ${left} fade` },
  ];
}

function shotPlaceholder(play: PlayHudView): string {
  if (play.holed) return "holed out";
  if (play.lie === "bunker" || play.lie === "sand") return "sw 35 splash";
  if (play.lie === "ocean") return "pw 80 after drop";
  if (play.lie === "woods") return "7 iron punch 120";
  if (play.lie === "green") return `putt ${Math.max(4, Math.round(play.remainingYards))}`;
  const left = Math.round(play.remainingYards);
  return `${clubForYards(left)} ${left}`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function drawMinimap(canvas: HTMLCanvasElement, hole: HoleData, ball: Vec2, shot?: ShotHudInfo): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const extras: Vec2[] = [ball];
  const pts = [...hole.path, hole.greenCenter, hole.tee, ...hole.bunkers.map((b) => b.center), ...extras];
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs) - 30;
  const maxX = Math.max(...xs) + 30;
  const minZ = Math.min(...zs) - 30;
  const maxZ = Math.max(...zs) + 30;
  const sx = canvas.width / (maxX - minX);
  const sz = canvas.height / (maxZ - minZ);
  const s = Math.min(sx, sz);
  const ox = (canvas.width - (maxX - minX) * s) / 2;
  const oz = (canvas.height - (maxZ - minZ) * s) / 2;
  const map = (p: Vec2): [number, number] => [ox + (p[0] - minX) * s, oz + (p[1] - minZ) * s];

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#102033");
  grad.addColorStop(1, "#0a1520");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(74, 168, 92, 0.9)";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  hole.path.forEach((p, i) => {
    const [x, y] = map(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#c9a56b";
  for (const b of hole.bunkers) {
    const [x, y] = map(b.center);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const [gx, gy] = map(hole.greenCenter);
  ctx.fillStyle = "#62c46a";
  ctx.beginPath();
  ctx.ellipse(gx, gy, 7, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const [tx, ty] = map(hole.tee);
  ctx.fillStyle = "#f6f0e4";
  ctx.beginPath();
  ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
  ctx.fill();

  const [bx, by] = map(ball);
  ctx.fillStyle = shot?.kind === "preview" ? "#9ad4ff" : "#ffe08a";
  ctx.beginPath();
  ctx.arc(bx, by, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}
