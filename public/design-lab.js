import {
  defaultContract,
  evaluateContract,
  validateContract,
} from "/shared/contract.js";
import { deliveryReceipts, householdComparison } from "/shared/receipts.js";
import { sensitivitySweep } from "/shared/sensitivity.js";

const $ = (id) => document.getElementById(id);
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function setupDesignLab({
  getState,
  commit,
  api,
  ensureLiveAccess,
  setBusy,
  refreshStatus,
  notify,
  replay,
}) {
  let selectedHouse = null,
    sweep = null,
    sweepKey = null;
  const current = () => getState().world.contract ?? defaultContract();
  function fill(contract) {
    for (const [field, id] of [
      ["minimumOnTime", "brief-total"],
      ["minimumPerHouse", "brief-house"],
      ["maximumWait", "brief-wait"],
    ])
      $(id).value = contract[field] ?? "";
    $("brief-dispatch").checked = contract.allowDispatch;
    $("brief-bridges").innerHTML = getState()
      .world.bridges.map(
        (b) =>
          `<label><input type="checkbox" data-brief-bridge="${esc(b.id)}" ${contract.bridgeIds === null || contract.bridgeIds.includes(b.id) ? "checked" : ""}> ${esc(b.label ?? b.id)} · row ${b.y + 1}</label>`,
      )
      .join("");
  }
  function read() {
    const ids = [
      ...document.querySelectorAll("[data-brief-bridge]:checked"),
    ].map((x) => x.dataset.briefBridge);
    return validateContract(
      {
        version: 1,
        minimumOnTime:
          $("brief-total").value === "" ? null : Number($("brief-total").value),
        minimumPerHouse:
          $("brief-house").value === "" ? null : Number($("brief-house").value),
        maximumWait:
          $("brief-wait").value === "" ? null : Number($("brief-wait").value),
        allowDispatch: $("brief-dispatch").checked,
        bridgeIds: ids.length === getState().world.bridges.length ? null : ids,
      },
      getState().world,
    );
  }
  $("edit-brief").addEventListener("click", () => {
    if (getState().busy) return;
    fill(current());
    $("brief-instruction").value = getState().briefInstruction ?? "";
    $("brief-status").textContent =
      "Review the measurable conditions, then confirm. Resources, deadlines and schedule remain locked during each repair.";
    $("brief-dialog").showModal();
  });
  $("close-brief").addEventListener("click", () => $("brief-dialog").close());
  $("brief-default").addEventListener("click", () => fill(defaultContract()));
  $("brief-queues").addEventListener("click", () => {
    const w = getState().world;
    fill({
      ...defaultContract(),
      minimumOnTime: w.houses.reduce((n, h) => n + h.demand, 0) - 1,
      minimumPerHouse: Math.max(
        0,
        Math.min(...w.houses.map((h) => h.demand)) - 1,
      ),
      maximumWait: 5,
    });
    $("brief-status").textContent =
      "A different design goal. Confirm it before testing candidates; it does not change game rules.";
  });
  $("brief-apply").addEventListener("click", () => {
    try {
      const world = structuredClone(getState().world);
      world.contract = read();
      commit(world, { briefInstruction: $("brief-instruction").value });
      $("brief-dialog").close();
      notify(
        "Test brief confirmed. Previous trials were cleared; the prior world is a checkpoint.",
      );
    } catch (error) {
      $("brief-status").textContent = error.message;
    }
  });
  $("compile-brief").addEventListener("click", async () => {
    if (getState().busy || !(await ensureLiveAccess())) return;
    // The access dialog can replace this dialog in public mode.
    if (!$("brief-dialog").open) $("brief-dialog").showModal();
    setBusy(true);
    $("brief-status").textContent = "Muse Spark is translating your brief…";
    try {
      const result = await api("/api/contract", {
        world: getState().world,
        instruction: $("brief-instruction").value,
      });
      if (!result.supported) {
        $("brief-status").textContent = result.unsupported.join(" · ");
        return;
      }
      fill(validateContract(result.contract, getState().world));
      $("brief-status").textContent =
        `${result.explanation} Review every condition and confirm; nothing has been applied yet.`;
    } catch (error) {
      $("brief-status").textContent = error.message;
    } finally {
      setBusy(false);
      await refreshStatus();
    }
  });
  function renderReceipts() {
    const s = getState(),
      a = s.run,
      b = s.candidate?.run;
    if (!a.houses.some((h) => h.id === selectedHouse))
      selectedHouse =
        s.selected && a.houses.some((h) => h.id === s.selected)
          ? s.selected
          : (a.houses.find(
              (h) =>
                b && b.houses.find((x) => x.id === h.id)?.onTime !== h.onTime,
            )?.id ?? a.houses[0].id);
    $("receipt-house").innerHTML = householdComparison(a)
      .map(
        (h) =>
          `<option value="${esc(h.id)}" ${h.id === selectedHouse ? "selected" : ""}>${esc(h.label)}</option>`,
      )
      .join("");
    $("receipt-households").innerHTML =
      `<table class="house-table"><thead><tr><th>Home</th><th>A on time</th><th>B on time</th><th>Change</th><th>Completion A → B</th></tr></thead><tbody>${householdComparison(
        a,
        b,
      )
        .map(
          (h) =>
            `<tr class="${h.delta < 0 ? "receipt-regression" : ""}"><td><button class="text-button" data-receipt-home="${esc(h.id)}">${esc(h.label)}</button></td><td>${h.before ?? "—"}</td><td>${h.after ?? "—"}</td><td>${h.delta === null ? "—" : h.delta > 0 ? `+${h.delta}` : h.delta}</td><td>${h.completedBefore ?? "pending"} → ${h.completedAfter ?? "—"}</td></tr>`,
        )
        .join("")}</tbody></table>`;
    const ar = deliveryReceipts(a, selectedHouse),
      br = b ? deliveryReceipts(b, selectedHouse) : [];
    const cell = (r, side) =>
      r
        ? `<button class="receipt-replay" data-receipt-tick="${r.deliveredAt}" data-receipt-courier="${esc(r.agentId)}" data-receipt-side="${side}">T${r.dispatchedAt} → T${r.deliveredAt} · ${r.slack >= 0 ? `${r.slack} turns early` : `${-r.slack} turns late`}</button><small>${esc(r.agentId)} · ${r.outboundWaitingTurns} outbound waiting turns<br>${r.crossings.map((c) => `${esc(c.label)} at T${c.enteredAt}`).join("; ") || "No bridge crossing"}<br>${r.evidenceRefs.join(" → ")}</small>`
        : "Not delivered within the replay";
    $("receipt-trips").innerHTML =
      `<table class="house-table"><thead><tr><th>Delivery order</th><th>A · Original</th>${b ? "<th>B · Proposed</th>" : ""}</tr></thead><tbody>${Array.from({ length: Math.max(ar.length, br.length, a.houses.find((h) => h.id === selectedHouse).demand) }, (_, i) => `<tr><td>${i + 1}</td><td>${cell(ar[i], "a")}</td>${b ? `<td>${cell(br[i], "b")}</td>` : ""}</tr>`).join("")}</tbody></table>`;
  }
  $("receipt-house").addEventListener("change", () => {
    selectedHouse = $("receipt-house").value;
    renderReceipts();
  });
  $("receipts-panel").addEventListener("click", (event) => {
    const home = event.target.closest("[data-receipt-home]");
    if (home) {
      selectedHouse = home.dataset.receiptHome;
      renderReceipts();
      return;
    }
    const button = event.target.closest("[data-receipt-tick]");
    if (button) {
      replay({
        houseId: selectedHouse,
        tick: Number(button.dataset.receiptTick),
        courierId: button.dataset.receiptCourier,
        side: button.dataset.receiptSide,
      });
    }
  });
  $("run-stress").addEventListener("click", () => {
    const s = getState();
    if (s.busy || !s.candidate) return;
    try {
      sweep = sensitivitySweep(s.world, s.candidate.world, {
        axis: $("stress-axis").value,
        bridgeId: $("stress-bridge").value || null,
      });
      sweepKey = JSON.stringify([s.world, s.candidate.world]);
      renderStress();
    } catch (error) {
      $("stress-results").textContent = error.message;
    }
  });
  $("stress-axis").addEventListener("change", () => {
    $("stress-bridge-label").hidden =
      $("stress-axis").value !== "bridge-position";
    sweep = null;
    renderStress();
  });
  $("stress-bridge").addEventListener("change", () => {
    sweep = null;
    renderStress();
  });
  $("export-stress").addEventListener("click", () => {
    if (!sweep) return;
    const s = getState();
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "liveworld-sensitivity-v1",
            original: s.world,
            proposed: s.candidate.world,
            sweep,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "liveworld-sensitivity.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  function renderStress() {
    const s = getState();
    $("run-stress").disabled = s.busy || !s.candidate;
    $("export-stress").disabled = !sweep;
    $("stress-results").innerHTML = sweep
      ? `<p><strong>A passes ${sweep.passedA}/${sweep.validCases}; B passes ${sweep.passedB}/${sweep.validCases} selected valid conditions.</strong> This is a finite design check, not a reliability percentage.</p><div class="lab-table"><table class="house-table"><thead><tr><th>Offset (turns / cells)</th><th>A on time</th><th>A brief</th><th>B on time</th><th>B wait</th><th>B brief</th><th>B completion slack</th></tr></thead><tbody>${sweep.cases.map((c) => (c.valid ? `<tr><td>${c.offset > 0 ? "+" : ""}${c.offset}${c.offset === 0 ? " · nominal" : ""}</td><td>${c.a.metrics.onTime}/${c.a.metrics.demand}</td><td>${c.a.contract.passed ? "PASS" : "FAIL"}</td><td>${c.b.metrics.onTime}/${c.b.metrics.demand}</td><td>${c.b.metrics.waitTicks}</td><td>${c.b.contract.passed ? "PASS" : "FAIL"}</td><td>${c.b.completionSlack ?? "incomplete"}</td></tr>` : `<tr><td>${c.offset}</td><td colspan="6">Invalid placement/condition: ${esc(c.reason)}</td></tr>`)).join("")}</tbody></table></div><p class="lab-note">${esc(sweep.scope)} Completion slack is deadline minus the last arrival at each home, taking the minimum across homes; it is not the margin for every possible contract.</p>`
      : "<p>Select a proposed world, then run a declared set of conditions. A and B receive identical deadline shifts (−3…+3 turns), or the selected bridge is shifted in both worlds (−1, 0, +1 cell). The confirmed brief stays fixed. Invalid conditions remain visible.</p>";
  }
  function render() {
    const s = getState(),
      a = evaluateContract(s.run),
      b = s.candidate
        ? evaluateContract(s.candidate.run, s.world.contract)
        : null;
    for (const input of $("brief-dialog").querySelectorAll("input, textarea"))
      input.disabled = s.busy;
    $("brief-default").disabled = s.busy;
    $("brief-queues").disabled = s.busy;
    $("brief-summary").textContent =
      a.checks
        .filter((c) => !c.houseId)
        .map((c) => c.label)
        .join(" · ") +
      (current().minimumPerHouse !== null
        ? ` · Every home ≥${current().minimumPerHouse} on time`
        : "");
    $("brief-outcome").textContent =
      `A: ${a.passed ? "PASS" : "FAIL"}${b ? ` · B: ${b.passed ? "PASS" : "FAIL"}` : ""}`;
    $("brief-checks").innerHTML = a.checks
      .map((c) => {
        const bc = b?.checks.find((x) => x.id === c.id),
          home = s.world.houses.find((h) => h.id === c.houseId);
        return `<li>${esc(c.label)}${home ? ` (cell ${home.x + 1}, ${home.y + 1})` : ""}: A ${c.actual} ${c.passed ? "✓" : "✕"}${b ? ` · B ${bc?.actual ?? "—"} ${bc?.passed ? "✓" : "✕"}` : ""}</li>`;
      })
      .join("");
    const editable = current().bridgeIds;
    $("brief-permissions").textContent =
      `One edit per trial · ${current().allowDispatch ? "dispatch allowed" : "dispatch locked"} · ${editable === null ? "all existing bridges editable" : editable.length ? editable.map((id) => s.world.bridges.find((b) => b.id === id)?.label ?? id).join(", ") : "bridges locked"} · resources, deadlines and schedule locked`;
    $("edit-brief").disabled = s.busy;
    $("brief-apply").disabled = s.busy;
    $("compile-brief").disabled =
      s.busy || !s.status?.configured || Boolean(s.status.budget?.blocked);
    renderReceipts();
    const prior = $("stress-bridge").value;
    $("stress-bridge").innerHTML = s.world.bridges
      .filter((x) => s.candidate?.world.bridges.some((b) => b.id === x.id))
      .map(
        (b) => `<option value="${esc(b.id)}">${esc(b.label ?? b.id)}</option>`,
      )
      .join("");
    if ([...$("stress-bridge").options].some((x) => x.value === prior))
      $("stress-bridge").value = prior;
    if (sweepKey !== JSON.stringify([s.world, s.candidate?.world]))
      sweep = null;
    renderStress();
  }
  return { render };
}
