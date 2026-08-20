import type { CourseData, HoleData, TeeSet, CameraMode, Vec2 } from "../course/types";
import type { Lie } from "../shot/lie";
import type { HoleShot } from "../shot/play";
import type { RoundCard, RoundThru } from "../shot/round";
import { WIND_FROM, type WindCondition, type WindFrom } from "../shot/wind";
import { lieShort, type HereBook } from "../shot/yardage";

export interface HudState {
  hole: number;
  tee: TeeSet;
  camera: CameraMode;
}

export interface ShotHudInfo {
  summary?: string;
  outcome?: string;
  carry?: number;
  roll?: number;
  total?: number;
  peak?: number;
  leftover?: number;
  leftoverLabel?: string;
  landLie?: string;
  kind?: "preview" | "result";
  trouble?: string;
  land?: Vec2;
  target?: Vec2;
  plannedCarry?: number;
  miss?: string;
  missDanger?: boolean;
  missLandings?: Vec2[];
}

export interface PlayHudView {
  holeNumber: number;
  strokes: number;
  penalties: number;
  scoreLabel: string;
  lie: Lie;
  lieLabel: string;
  remainingYards: number;
  pinYards: number;
  leftoverLabel: string;
  holed: boolean;
  onTee: boolean;
  ball: Vec2;
  shots: HoleShot[];
  book: HereBook;
  suggestion: { label: string; prompt: string };
  cardYards: number;
  wind: WindCondition;
  windOnShot: string;
  round: RoundCard;
  thru: RoundThru;
}

export interface HudHandlers {
  onChange: (next: Partial<HudState>) => void;
  onShot: (prompt: string) => void;
  onPreview: (prompt: string) => void;
  onReset: () => void;
  onWind: (next: Partial<WindCondition>) => void;
  onNewRound: () => void;
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
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);
  const teeName = course.scorecard[state.tee]?.name ?? TEE_LABELS[state.tee];
  const chips = shotChips(play);
  const placeholder = play.suggestion.prompt;

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
          <b>${play.holed ? "Holed" : play.leftoverLabel.replace(" to pin", "")}</b>
        </div>
      </div>
      ${shotListHtml(play)}
    </div>

    <nav class="holes">
      ${holes
        .map((n) => {
          const card = play.round.holes.find((h) => h.number === n);
          const posted = card?.strokes != null;
          return `<button type="button" class="${n === hole.number ? "on" : ""} ${posted ? "posted" : ""}" data-hole="${n}">${n}${posted ? `<small>${card!.strokes}</small>` : ""}</button>`;
        })
        .join("")}
    </nav>
    ${scorecardHtml(play, hole.number)}

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
        <div class="seg cam-seg">
          <button type="button" data-cam="address" class="${state.camera === "address" ? "on" : ""}">Stand</button>
          <button type="button" data-cam="tee" class="${state.camera === "tee" ? "on" : ""}">Tee</button>
          <button type="button" data-cam="flyover" class="${state.camera === "flyover" ? "on" : ""}">Fly</button>
          <button type="button" data-cam="green" class="${state.camera === "green" ? "on" : ""}">Green</button>
          <button type="button" data-cam="overview" class="${state.camera === "overview" ? "on" : ""}">Course</button>
        </div>
      </div>
      <div class="control-block">
        <span class="label">Wind</span>
        <div class="seg wind-seg">
          ${WIND_FROM.map(
            (d) =>
              `<button type="button" data-wind-from="${d}" class="${play.wind.from === d ? "on" : ""}">${d}</button>`,
          ).join("")}
        </div>
        <div class="wind-mph">
          <button type="button" data-wind-mph-delta="-2" ${play.wind.mph <= 0 ? "disabled" : ""}>−</button>
          <b>${play.wind.mph === 0 ? "Still" : `${play.wind.mph} mph`}</b>
          <button type="button" data-wind-mph-delta="2" ${play.wind.mph >= 32 ? "disabled" : ""}>+</button>
          ${[0, 8, 14, 20]
            .map(
              (n) =>
                `<button type="button" data-wind-mph="${n}" class="${play.wind.mph === n ? "on" : ""}">${n === 0 ? "0" : n}</button>`,
            )
            .join("")}
        </div>
        <p class="wind-on-shot">${play.windOnShot}</p>
      </div>
    </div>

    <div class="panel shot">
      <div class="shot-head">
        <h2>Call your shot</h2>
        <div class="shot-actions">
          <button type="button" class="reset" data-reset>Reset hole</button>
          <button type="button" class="reset" data-new-round>New round</button>
        </div>
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
        <h2>From here</h2>
      </div>
      <canvas class="mini" width="340" height="140"></canvas>
      <ul class="book-list">
        ${bookListHtml(play, shot, yards)}
      </ul>
    </div>

    <p class="hint">Stand looks down the line · click to aim · miss envelope is the slight miss · ${play.suggestion.label} · r resets hole</p>
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
  el.querySelector<HTMLButtonElement>("[data-new-round]")!.onclick = () => handlers.onNewRound();
  el.querySelectorAll<HTMLButtonElement>("[data-wind-from]").forEach((btn) => {
    btn.onclick = () => handlers.onWind({ from: btn.dataset.windFrom as WindFrom });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-wind-mph]").forEach((btn) => {
    btn.onclick = () => handlers.onWind({ mph: Number(btn.dataset.windMph) });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-wind-mph-delta]").forEach((btn) => {
    btn.onclick = () => handlers.onWind({ mph: play.wind.mph + Number(btn.dataset.windMphDelta) });
  });

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
  if (left) left.textContent = play.holed ? "Holed" : play.leftoverLabel.replace(" to pin", "");
  const book = el.querySelector(".book-list");
  if (book) book.innerHTML = bookListHtml(play, shot, play.cardYards);
  const windLine = el.querySelector(".wind-on-shot");
  if (windLine) windLine.textContent = play.windOnShot;
  const windMph = el.querySelector(".wind-mph b");
  if (windMph) windMph.textContent = play.wind.mph === 0 ? "Still" : `${play.wind.mph} mph`;
  const hint = el.querySelector(".hint");
  if (hint) hint.textContent = `Stand looks down the line · click to aim · miss envelope is the slight miss · ${play.suggestion.label} · r resets hole`;
}

function shotPanelHtml(shot: ShotHudInfo | undefined, play: PlayHudView): string {
  if (play.holed) {
    const pen = play.penalties ? ` (${play.penalties} penalty)` : "";
    const next = play.holeNumber >= 18 ? "Round complete. New round to play again." : "Next tee shortly — or reset this hole.";
    return `<p class="idle">Holed out in ${play.strokes}${pen}. ${next}</p>`;
  }
  if (!shot?.outcome) {
    return `<p class="idle">Type a club and yards. Preview is the real flight — carry, roll, leftover, and trouble — before you Hit.</p>`;
  }
  const kind = shot.kind === "preview" ? "preview" : "result";
  const label = kind === "preview" ? "Preview" : "Result";
  const hazard = shot.trouble ? ` hazard ${shot.trouble}` : "";
  return `<div class="result ${kind}${hazard}">
    <p class="summary"><span class="kind-pill ${kind}">${label}</span> ${shot.summary ?? ""}</p>
    <p class="outcome">${shot.outcome}</p>
    <div class="nums four">
      <div><em>Carry</em><b>${shot.carry}</b></div>
      <div><em>Roll</em><b>${shot.roll ?? Math.max(0, (shot.total ?? 0) - (shot.carry ?? 0))}</b></div>
      <div><em>Peak</em><b>${shot.peak}<small>y</small></b></div>
      <div><em>Left</em><b>${shot.leftoverLabel ?? shot.leftover}</b></div>
    </div>
    ${shot.miss ? `<p class="miss-line ${shot.missDanger ? "danger" : "safe"}">${shot.miss}</p>` : ""}
  </div>`;
}

function scorecardHtml(play: PlayHudView, currentHole: number): string {
  const front = play.round.holes.filter((h) => h.number <= 9);
  const back = play.round.holes.filter((h) => h.number >= 10);
  const row = (holes: typeof front, title: string) => {
    const par = holes.reduce((n, h) => n + h.par, 0);
    const strokes = holes.every((h) => h.strokes == null) ? "—" : String(holes.reduce((n, h) => n + (h.strokes ?? 0), 0));
    return `<div class="score-nine">
      <div class="score-row ids"><em>${title}</em>${holes
        .map(
          (h) =>
            `<button type="button" class="score-id${h.number === currentHole ? " on" : ""}" data-hole="${h.number}">${h.number}</button>`,
        )
        .join("")}<span>Tot</span></div>
      <div class="score-row par"><em>Par</em>${holes.map((h) => `<span>${h.par}</span>`).join("")}<span>${par}</span></div>
      <div class="score-row strokes"><em>Strokes</em>${holes
        .map((h) => `<span class="${h.completed ? "done" : ""}">${h.strokes ?? "·"}</span>`)
        .join("")}<span>${strokes}</span></div>
    </div>`;
  };
  return `<div class="panel scorecard">
    ${row(front, "Out")}
    ${row(back, "In")}
    <p class="round-line">Round <b>${play.thru.label}</b>${play.thru.played ? ` · ${play.thru.strokes} thru ${play.thru.played}` : ""} · par ${play.thru.played ? play.thru.par : "—"}</p>
  </div>`;
}

function shotListHtml(play: PlayHudView): string {
  if (!play.shots.length && !play.holed) {
    return `<p class="card-empty">No shots yet · score ${play.scoreLabel}</p>`;
  }
  const rows = play.shots
    .map((s, i) => {
      const left = s.leftoverUnit === "" ? "holed" : `${s.leftover} ${s.leftoverUnit}`;
      return `<li><em>${i + 1}</em><span>${s.clubLabel} ${s.carryYards}/${s.totalYards}</span><b>${lieShort(s.lieIn)} → ${lieShort(s.lieOut)} · ${left}</b></li>`;
    })
    .join("");
  return `<div class="card">
    <ol>${rows}</ol>
    <p class="card-score">Score <b>${play.holed ? play.strokes : play.scoreLabel}</b>${play.penalties ? ` · ${play.penalties} pen` : ""}</p>
  </div>`;
}

function bookListHtml(play: PlayHudView, shot: ShotHudInfo | undefined, cardYards: number): string {
  const carry = shot?.plannedCarry ?? shot?.carry;
  const hazards = play.book.hazards.slice(0, 4);
  const cover = play.book.firstTrouble;
  const coverLine = cover
    ? carry == null
      ? `need ${cover.exitYards} to cover ${cover.label.toLowerCase()}`
      : clearStatusLine(cover, carry)
    : "nothing on the line";
  return `
    <li><span>To pin</span><b>${play.holed ? "Holed" : play.leftoverLabel.replace(" to pin", "")}</b></li>
    <li><span>Play</span><b>${play.suggestion.label}</b></li>
    <li><span>In play</span><b>${coverLine}</b></li>
    ${hazards
      .map((h) => {
        const extra = carry == null ? `${h.exitYards} to cover` : clearStatusLine(h, carry);
        return `<li><span>${h.label}</span><b>${extra}</b></li>`;
      })
      .join("")}
    <li><span>Card</span><b>${cardYards} yds</b></li>
  `;
}

function clearStatusLine(hazard: { label: string; carryYards: number; exitYards: number }, carry: number): string {
  if (carry + 0.5 < hazard.carryYards) return `${hazard.carryYards} · short (need ${hazard.exitYards})`;
  if (carry + 0.5 < hazard.exitYards) return `${hazard.carryYards} · in it`;
  return `${hazard.carryYards} · covers`;
}

export function shotChips(play: PlayHudView): { label: string; prompt: string }[] {
  if (play.holed) return [];
  const suggested = play.suggestion;
  if (play.lie === "ocean") {
    return [suggested, { label: "7i after drop", prompt: "7 iron 140" }];
  }
  if (play.lie === "bunker" || play.lie === "sand") {
    return [suggested, { label: "lw 20", prompt: "lw 20" }];
  }
  if (play.lie === "green" || play.remainingYards <= 18) {
    const feet = Math.max(3, Math.round(play.pinYards * 3));
    return [suggested, { label: "lag putt", prompt: `putt ${Math.max(4, Math.round(feet * 0.75))} ft` }];
  }
  if (play.lie === "woods") {
    return [suggested, { label: "punch 8i", prompt: "8 iron 90" }];
  }
  return [
    suggested,
    { label: `${suggested.label} draw`, prompt: `${suggested.prompt} draw` },
    { label: `${suggested.label} fade`, prompt: `${suggested.prompt} fade` },
  ];
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function drawMinimap(canvas: HTMLCanvasElement, hole: HoleData, ball: Vec2, shot?: ShotHudInfo): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const extras: Vec2[] = [ball];
  if (shot?.land) extras.push(shot.land);
  if (shot?.target) extras.push(shot.target);
  if (shot?.missLandings) extras.push(...shot.missLandings);
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
  if (shot?.target) {
    const [ax, ay] = map(shot.target);
    ctx.strokeStyle = "rgba(240, 213, 154, 0.55)";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#f0d59a";
    ctx.beginPath();
    ctx.arc(ax, ay, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (shot?.missLandings?.length) {
    ctx.fillStyle = shot.missDanger ? "rgba(232, 197, 106, 0.85)" : "rgba(154, 180, 204, 0.7)";
    for (const m of shot.missLandings) {
      const [mx, my] = map(m);
      ctx.beginPath();
      ctx.arc(mx, my, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (shot?.land) {
    const [lx, ly] = map(shot.land);
    ctx.strokeStyle = shot.trouble === "ocean" ? "rgba(62,198,232,0.9)" : shot.trouble === "bunker" ? "rgba(232,197,106,0.9)" : "rgba(154,212,255,0.75)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(lx, ly);
    ctx.stroke();
    ctx.fillStyle = shot.trouble === "ocean" ? "#3ec6e8" : shot.trouble === "bunker" ? "#e8c56a" : "#9ad4ff";
    ctx.beginPath();
    ctx.arc(lx, ly, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = shot?.kind === "preview" ? "#9ad4ff" : "#ffe08a";
  ctx.beginPath();
  ctx.arc(bx, by, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}
