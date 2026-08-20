import type { CourseData, HoleData, TeeSet, CameraMode } from "../course/types";

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
  onChange: (next: Partial<HudState>) => void,
  onShot: (prompt: string) => void,
  shot?: ShotHudInfo,
): void {
  const yards = hole.yards[state.tee];
  const bunkers = hole.bunkers.slice(0, 5);
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);
  const placeholders = [
    "driver 265 slight fade",
    "7 iron 155 draw",
    "pw 105 into 12 mph wind",
    "3 wood 230 off the left",
  ];
  const placeholder = placeholders[hole.number % placeholders.length];
  const teeName = course.scorecard[state.tee]?.name ?? TEE_LABELS[state.tee];

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
          <button type="button" data-cam="tee" class="${state.camera === "tee" ? "on" : ""}">Tee</button>
          <button type="button" data-cam="flyover" class="${state.camera === "flyover" ? "on" : ""}">Flyover</button>
          <button type="button" data-cam="green" class="${state.camera === "green" ? "on" : ""}">Green</button>
          <button type="button" data-cam="overview" class="${state.camera === "overview" ? "on" : ""}">Course</button>
        </div>
      </div>
    </div>

    <div class="panel shot">
      <div class="shot-head">
        <h2>Call your shot</h2>
      </div>
      <form class="shot-form">
        <input
          name="prompt"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="${placeholder}"
        />
        <button type="submit">Hit</button>
      </form>
      <div class="chips">
        <button type="button" data-ex="driver 250 slight fade">driver 250 fade</button>
        <button type="button" data-ex="7 iron 150 draw">7i 150 draw</button>
        <button type="button" data-ex="pw 100 into 10 mph wind">pw into wind</button>
      </div>
      ${
        shot?.outcome
          ? `<div class="result">
              <p class="summary">${shot.summary ?? ""}</p>
              <p class="outcome">${shot.outcome}</p>
              <div class="nums">
                <div><em>Carry</em><b>${shot.carry}</b></div>
                <div><em>Total</em><b>${shot.total}</b></div>
                <div><em>Peak</em><b>${shot.peak}<small>y</small></b></div>
              </div>
            </div>`
          : `<p class="idle">Type club, yards, and shape. Flight uses this hole's yardages and hazards.</p>`
      }
    </div>

    <div class="panel book">
      <div class="book-head">
        <h2>Yardage book</h2>
      </div>
      <canvas class="mini" width="340" height="140"></canvas>
      <ul>
        <li><span>Scorecard</span><b>${yards} yds</b></li>
        <li><span>Mapped path</span><b>${Math.round(hole.osmPathYards)} yds</b></li>
        ${bunkers
          .map(
            (b) =>
              `<li><span>Bunker ${b.side} at ${Math.round(b.yardsFromTee)}</span><b>${Math.round(b.yardsToGreen)} to green</b></li>`,
          )
          .join("")}
        ${hole.bunkers.length === 0 ? "<li><span>No mapped bunkers</span><b>-</b></li>" : ""}
      </ul>
    </div>

    <p class="hint">Drag to orbit · right-drag to pan · scroll to zoom · arrows change holes</p>
  `;

  el.querySelectorAll<HTMLButtonElement>("[data-hole]").forEach((btn) => {
    btn.onclick = () => onChange({ hole: Number(btn.dataset.hole) });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-tee]").forEach((btn) => {
    btn.onclick = () => onChange({ tee: btn.dataset.tee as TeeSet });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-cam]").forEach((btn) => {
    btn.onclick = () => onChange({ camera: btn.dataset.cam as CameraMode });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-ex]").forEach((btn) => {
    btn.onclick = () => onShot(btn.dataset.ex ?? "");
  });

  const form = el.querySelector<HTMLFormElement>(".shot-form");
  const input = el.querySelector<HTMLInputElement>("input[name=prompt]");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input?.value.trim();
    if (value) onShot(value);
  });

  const mini = el.querySelector<HTMLCanvasElement>(".mini");
  if (mini) drawMinimap(mini, hole);
}

function drawMinimap(canvas: HTMLCanvasElement, hole: HoleData): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pts = [...hole.path, hole.greenCenter, hole.tee, ...hole.bunkers.map((b) => b.center)];
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
  const map = (p: [number, number]): [number, number] => [
    ox + (p[0] - minX) * s,
    oz + (p[1] - minZ) * s,
  ];

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
}
