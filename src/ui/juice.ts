import type { JuiceBeat } from "../shot/juice";

export function renderJuice(
  el: HTMLElement,
  beat: JuiceBeat | null,
  handlers: { onNewRound?: () => void } = {},
): void {
  if (!beat) {
    el.hidden = true;
    el.innerHTML = "";
    el.className = "juice";
    return;
  }

  el.hidden = false;
  el.className = `juice juice-${beat.kind}`;

  if (beat.kind === "shot") {
    el.innerHTML = `<div class="juice-toast tone-${beat.tone}"><strong>${escapeText(beat.headline)}</strong><span>${escapeText(beat.detail)}</span></div>`;
    return;
  }

  const tone = beat.toPar <= 0 ? "good" : beat.toPar === 1 ? "neutral" : "bad";
  const kicker = beat.kind === "round-done" ? "Round complete" : `Hole ${beat.hole}`;
  const title = beat.kind === "round-done" ? beat.thruLabel : beat.headline;
  const meta =
    beat.kind === "round-done"
      ? `<b>${beat.strokes}</b> · ${escapeText(beat.toParLabel)} · ${escapeText(beat.headline)}`
      : `<b>${beat.strokes}</b> · ${escapeText(beat.toParLabel)} · thru ${escapeText(beat.thruLabel)}`;
  const action =
    beat.kind === "round-done"
      ? `<button type="button" class="juice-action" data-juice-new-round>New round</button>`
      : beat.nextHole
        ? `<p class="juice-next">Next · hole ${beat.nextHole}</p>`
        : "";

  el.innerHTML = `<div class="juice-banner tone-${tone} ${beat.kind}">
      <p class="juice-kicker">${kicker}</p>
      <h2>${escapeText(title)}</h2>
      <p class="juice-meta">${meta}</p>
      ${action}
    </div>`;

  const btn = el.querySelector<HTMLButtonElement>("[data-juice-new-round]");
  if (btn && handlers.onNewRound) btn.onclick = () => handlers.onNewRound?.();
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
