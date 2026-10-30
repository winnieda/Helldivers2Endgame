"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { endRun, feedbackUrl } from "@/lib/feedback";
import { useEffect, useState } from "react";
import {
  activeDivers,
  advance,
  beginDebrief,
  blitzRequiredMargin,
  DIFFICULTY_NAMES,
  endCampaign,
  FACTION_LABEL,
  ITEMS,
  nextOperation,
  OUTCOME_LABEL,
  scoreCampaign,
  setResult,
  setSquadOutcome,
  setSquadPayout,
  suggestedEarnings,
  type Campaign,
  type MissionOutcome,
} from "@engine";
import { DIVER_COLORS, ordinal, req } from "@/lib/format";
import { store } from "@/lib/store";
import { ArrowCode, Emblem, FactionEmblem, ItemIcon, ReqIcon } from "../icons";
import { openTerminal } from "@/lib/devtools";
import { Modal, Req, Stepper } from "../ui";
import { useCampaign } from "./useCampaign";

const OUTCOMES: MissionOutcome[] = ["extracted", "completed", "failed"];
const OUTCOME_TONE: Record<MissionOutcome, string> = {
  extracted: "var(--good)",
  completed: "var(--warn)",
  failed: "var(--bad)",
};

export function MissionHeader({ c, title }: { c: Campaign; title: string }) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <FactionEmblem faction={c.faction} size={44} />
      <div>
        <div className="eyebrow">
          {c.mode === "operations"
            ? `${c.operationName} · mission ${c.missionInOp} of ${c.rules.missionsPerOperation}`
            : `Budget Blitz · round ${c.round}`}{" "}
          · vs {FACTION_LABEL[c.faction]} · {DIFFICULTY_NAMES[c.difficulty]} (
          {c.difficulty})
        </div>
        <h1 className="h-display text-[40px] sm:text-[52px]">{title}</h1>
      </div>
    </div>
  );
}

/** The small "work in progress" tag used on unfinished features. */
const WipTag = ({ title }: { title?: string }) => (
  <span
    className="text-[10px] font-sans font-bold tracking-normal px-1 py-px bg-warn/20 text-warn"
    title={title}
  >
    WIP
  </span>
);

export function Deployed() {
  const { campaign: c, apply, confirmResults } = useCampaign();
  const [confirmFail, setConfirmFail] = useState(false);
  if (!c) return null;
  const isOps = c.mode === "operations";
  return (
    <div>
      <MissionHeader c={c} title="Squad deployed" />
      <div className="mt-5 flex gap-3 flex-wrap">
        <button
          className="btn btn-primary btn-lg"
          onClick={() => apply(beginDebrief)}
        >
          {isOps ? "Mission complete — debrief →" : "Mission over — debrief →"}
        </button>
        {isOps && (
          <button
            className="btn btn-ghost btn-lg"
            onClick={() => setConfirmFail(true)}
          >
            Mission failed
          </button>
        )}
      </div>
      <Modal
        open={confirmFail}
        onClose={() => setConfirmFail(false)}
        title="Mission failed?"
      >
        <p className="text-text-2">
          A failed mission ends the run. Your squad’s record goes into the hall
          of fame.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            data-autofocus
            className="btn btn-ghost"
            onClick={() => setConfirmFail(false)}
          >
            Back
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              setConfirmFail(false);
              apply((x) => setSquadPayout(beginDebrief(x), 0, "failed"));
              confirmResults();
            }}
          >
            The mission failed
          </button>
        </div>
      </Modal>
      <div className="mt-6 grid md:grid-cols-2 gap-4">
        {activeDivers(c).map((d) => (
          <div key={d.id} className="panel p-5">
            <div className="flex items-center justify-between">
              <div
                className="h-display text-[26px]"
                style={{ color: DIVER_COLORS[d.color] }}
              >
                {d.name}
              </div>
              <div className="text-[13px] text-muted">
                Paid{" "}
                <Req
                  value={d.locked?.total ?? 0}
                  className="text-text font-semibold"
                />
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              {(d.locked?.items ?? []).map((idx, s) => (
                <div key={s} className="flex items-center gap-3">
                  <ItemIcon item={ITEMS[idx]} size={32} />
                  <span className="flex-1 truncate text-[14px]">
                    {ITEMS[idx].name}
                  </span>
                  {ITEMS[idx].code && (
                    <ArrowCode code={ITEMS[idx].code} size="sm" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Operations debrief: the one number that matters, the Squad Payout from the end-of-mission
 * screen. Everyone in the squad earns it. (Failure is reported on the deployed screen.)
 */
export function Debrief() {
  const { campaign: c, apply, confirmResults } = useCampaign();
  const [payout, setPayout] = useState("");
  if (!c) return null;
  if (c.mode !== "operations") return <BlitzDebrief />;
  const value = payout === "" ? null : Number(payout);
  const finish = () => {
    if (value === null) return;
    apply((x) => setSquadPayout(x, value));
    confirmResults();
  };
  return (
    <div className="rise">
      <MissionHeader c={c} title="Debrief" />
      <div className="mt-6 panel panel-accent p-6 sm:p-8">
        <label
          htmlFor="squad-payout"
          className="font-display font-bold uppercase tracking-wider text-[24px]"
        >
          Squad Payout:
        </label>
        <div className="mt-3 flex items-center gap-3">
          <ReqIcon size={40} />
          <input
            id="squad-payout"
            autoFocus
            inputMode="numeric"
            className="field max-w-[300px] !text-[34px] !py-2 font-display font-bold tnum text-req"
            placeholder="0"
            value={value === null ? "" : value.toLocaleString("en-US")}
            onChange={(e) =>
              setPayout(e.target.value.replace(/[^0-9]/g, "").slice(0, 7))
            }
            onKeyDown={(e) => e.key === "Enter" && finish()}
          />
        </div>
        <p className="text-[14px] text-muted mt-3">
          The Requisition shown on the in-game “Squad Payout” screen at the end
          of the mission.{" "}
          {activeDivers(c).length > 1
            ? "Every Helldiver in the squad earns this amount."
            : "You earn this amount."}
        </p>
      </div>
      <div className="mt-4 panel p-6">
        <div className="flex items-center gap-2">
          <div className="font-display font-bold uppercase tracking-wider text-[18px]">
            Bonuses and Penalties
          </div>
          <WipTag title="Not built yet" />
        </div>
        <p className="text-[14px] text-muted mt-2">
          Coming later: adjustments on top of the Squad Payout, such as a cost
          for each reinforcement used.
        </p>
      </div>
      <div className="mt-6 flex justify-end">
        <button
          className="btn btn-primary btn-lg"
          disabled={value === null}
          onClick={finish}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

/** Budget Blitz debrief (the mode is under construction): per-diver outcome, earnings and reinforcements. */
function BlitzDebrief() {
  const { campaign: c, apply, confirmResults } = useCampaign();
  if (!c) return null;
  const divers = activeDivers(c);
  const squadOutcome = divers.every(
    (d) => d.result?.outcome === divers[0].result?.outcome,
  )
    ? divers[0].result?.outcome
    : undefined;
  const margin = blitzRequiredMargin(c.rules, c.round);

  return (
    <div className="rise">
      <MissionHeader c={c} title="Debrief" />
      <div className="mt-6 panel p-5">
        <div className="font-display font-bold uppercase tracking-wider">
          How did it go?
        </div>
        <div className="mt-3 grid sm:grid-cols-3 gap-2">
          {OUTCOMES.map((o) => (
            <button
              key={o}
              onClick={() => apply((x) => setSquadOutcome(x, o))}
              className="border px-4 py-3 text-left transition-colors"
              style={
                squadOutcome === o
                  ? {
                      borderColor: OUTCOME_TONE[o],
                      background: `color-mix(in srgb, ${OUTCOME_TONE[o]} 10%, transparent)`,
                    }
                  : { borderColor: "var(--line-2)" }
              }
              aria-pressed={squadOutcome === o}
            >
              <div
                className="font-display font-bold uppercase tracking-wider text-[17px]"
                style={{
                  color: squadOutcome === o ? OUTCOME_TONE[o] : undefined,
                }}
              >
                {OUTCOME_LABEL[o]}
              </div>
              <div className="text-[13px] text-muted">
                suggests{" "}
                <Req value={suggestedEarnings(c.rules, c.difficulty, o)} />
              </div>
            </button>
          ))}
        </div>
        <div className="text-[12.5px] text-muted mt-2">
          Applies to the whole squad. Enter the Requisition each of you actually
          earned if it differs.
        </div>
        {c.mode === "operations" && squadOutcome === "failed" && (
          <div className="mt-3 border border-bad/60 bg-bad/10 px-4 py-2.5 text-[14px] text-bad">
            A failed mission ends the run. Confirming this result closes the
            campaign and records it in the hall of fame.
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {divers.map((d) => {
          const r = d.result ?? {
            outcome: "extracted" as MissionOutcome,
            earned: 0,
            deaths: 0,
          };
          const reinforce = r.deaths * c.rules.reinforcementCost;
          const spent = d.locked?.total ?? 0;
          const profit = r.earned - spent - reinforce;
          const after = Math.min(
            c.rules.maxBalance,
            d.balance - reinforce + r.earned,
          );
          const out =
            c.mode === "operations" ? r.outcome === "failed" : profit <= margin;
          return (
            <div
              key={d.id}
              className="panel p-5 grid lg:grid-cols-[180px_1fr_1fr_1fr_1.2fr] gap-4 items-center"
              style={out ? { borderColor: "rgba(244,112,103,0.6)" } : undefined}
            >
              <div>
                <div
                  className="h-display text-[24px]"
                  style={{ color: DIVER_COLORS[d.color] }}
                >
                  {d.name}
                </div>
                {c.mode !== "operations" && (
                  <select
                    className="field !py-1 mt-1 text-[13px]"
                    value={r.outcome}
                    onChange={(e) =>
                      apply((x) =>
                        setResult(x, d.id, {
                          outcome: e.target.value as MissionOutcome,
                        }),
                      )
                    }
                    aria-label={`${d.name} outcome`}
                  >
                    {OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {OUTCOME_LABEL[o]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <label className="block">
                <span className="eyebrow">Requisition earned</span>
                <input
                  className="field mt-1 tnum text-[17px] font-semibold"
                  inputMode="numeric"
                  value={r.earned}
                  onChange={(e) =>
                    apply((x) =>
                      setResult(x, d.id, {
                        earned:
                          Number(e.target.value.replace(/[^0-9]/g, "")) || 0,
                      }),
                    )
                  }
                />
              </label>
              <div>
                <div className="eyebrow flex items-center gap-1.5">
                  Reinforcements used
                  <WipTag title="Recorded for stats only; reinforcements don’t cost anything (yet)" />
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <Stepper
                    value={r.deaths}
                    onChange={(v) =>
                      apply((x) => setResult(x, d.id, { deaths: v }))
                    }
                    max={40}
                    label={`${d.name} reinforcements`}
                  />
                </div>
              </div>
              <div className="text-[14px]">
                <div className="text-muted">Spent on loadout</div>
                <span className="inline-flex items-center gap-1 tnum font-semibold text-bad">
                  −<ReqIcon size={14} />
                  {req(spent)}
                </span>
              </div>
              <div className="text-[14px]">
                {c.mode === "operations" ? (
                  <>
                    <div className="text-muted">Balance after mission</div>
                    <div
                      className={`font-display font-bold text-[24px] tnum ${out ? "text-bad" : ""}`}
                    >
                      {out ? "RUN OVER" : req(after)}
                    </div>
                    {d.balance - reinforce + r.earned > c.rules.maxBalance && (
                      <div className="text-[12px] text-warn">
                        {req(
                          d.balance - reinforce + r.earned - c.rules.maxBalance,
                        )}{" "}
                        lost to the 50,000 cap
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="text-muted">
                      Profit this round{" "}
                      {margin > 0 && `(need > ${req(margin)})`}
                    </div>
                    <div
                      className={`font-display font-bold text-[24px] tnum ${out ? "text-bad" : "text-good"}`}
                    >
                      {profit >= 0 ? "+" : "−"}
                      {req(Math.abs(profit))}{" "}
                      {out && <span className="text-[15px]">ELIMINATED</span>}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex justify-end">
        <button className="btn btn-primary btn-lg" onClick={confirmResults}>
          Confirm results
        </button>
      </div>
    </div>
  );
}

export function Summary() {
  const router = useRouter();
  // Warm the feedback page so leaving the run shows it immediately.
  useEffect(() => {
    router.prefetch("/feedback/");
  }, [router]);
  const { campaign: c, apply } = useCampaign();
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (!c) return null;
  const last = c.log[c.log.length - 1];
  const success = last?.divers.some((d) => d.outcome === "extracted");
  const isOps = c.mode === "operations";
  const opDone = isOps && c.missionInOp >= c.rules.missionsPerOperation;
  const nextLabel = !isOps
    ? `Round ${c.round + 1} briefing`
    : opDone
      ? "Operation complete"
      : `Next mission (${c.missionInOp + 1}/${c.rules.missionsPerOperation})`;

  return (
    <div className="rise">
      <MissionHeader
        c={c}
        title={success ? "Mission accomplished" : "Mission failed"}
      />
      <div className="mt-6 grid md:grid-cols-2 gap-4">
        {last?.divers.map((r) => {
          const d = c.divers.find((x) => x.id === r.id)!;
          return (
            <div
              key={r.id}
              className="panel p-5"
              style={
                r.status !== "active"
                  ? { borderColor: "rgba(244,112,103,0.6)" }
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <div
                  className="h-display text-[26px]"
                  style={{ color: DIVER_COLORS[d.color] }}
                >
                  {r.name}
                </div>
                <span
                  className="chip"
                  style={{
                    color: r.status === "active" ? "var(--good)" : "var(--bad)",
                    borderColor: "currentColor",
                  }}
                >
                  {r.status === "active"
                    ? r.outcome === "failed"
                      ? "Mission failed"
                      : "Still in the fight"
                    : "Eliminated"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[14px] tnum">
                <span className="text-muted">Loadout</span>
                <span className="text-right font-semibold text-bad">
                  {r.total ? `−${req(r.total)}` : "0"}
                </span>
                <span className="text-muted">
                  Earned ({OUTCOME_LABEL[r.outcome].toLowerCase()})
                </span>
                <span className="text-right text-good">+{req(r.earned)}</span>
                <span className="text-muted font-semibold">Net</span>
                <span
                  className={`text-right font-semibold ${r.profit >= 0 ? "text-good" : "text-bad"}`}
                >
                  {r.profit >= 0 ? "+" : "−"}
                  {req(Math.abs(r.profit))}
                </span>
              </div>
              {isOps && (
                <div className="mt-4">
                  <div className="flex justify-between text-[13px] text-muted">
                    <span>Balance</span>
                    <span className="tnum">
                      {req(r.balanceBefore)} →{" "}
                      <span className="text-text font-semibold">
                        {req(r.balanceAfter)}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 mt-1 relative bg-req/10">
                    <div
                      className="absolute inset-y-0 left-0 bg-req transition-[width] duration-500"
                      style={{
                        width: `${(r.balanceAfter / c.rules.maxBalance) * 100}%`,
                      }}
                    />
                  </div>
                  {r.wasted > 0 && (
                    <div className="text-[12px] text-warn mt-1">
                      {req(r.wasted)} Requisition lost to the cap — spend it
                      next time.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex gap-3 flex-wrap justify-end">
        {!(opDone && success) && (
          <button
            className="btn btn-ghost"
            onClick={() => setConfirmEnd(true)}
          >
            Stand down (end campaign)
          </button>
        )}
        <button
          className="btn btn-primary btn-lg"
          onClick={() => {
            // Finishing an operation: feedback first, then the intermission (keep going or stand down).
            apply(advance);
            if (opDone && success) router.push(feedbackUrl('operation'));
          }}
        >
          {nextLabel} →
        </button>
      </div>
      <Modal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End the campaign?"
      >
        <p className="text-text-2">
          Your squad retires with its current record. It goes into the hall of
          fame.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            data-autofocus
            className="btn btn-ghost"
            onClick={() => setConfirmEnd(false)}
          >
            Keep fighting
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              setConfirmEnd(false);
              if (c) endRun(c);
              router.push(feedbackUrl('standdown'));
            }}
          >
            Stand down
          </button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Between operations: the squad finished all three missions and decides whether to start the next
 * operation or stand down. Shown after the operation's feedback form.
 */
export function Intermission() {
  const { campaign: c, apply } = useCampaign();
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (!c) return null;
  const score = scoreCampaign(c);
  const done = score.operationsCompleted;
  const ops = `${done} operation${done === 1 ? "" : "s"}`;
  return (
    <div className="rise">
      <div className="flex items-center gap-4 flex-wrap">
        <FactionEmblem faction={c.faction} size={44} />
        <div>
          <div className="eyebrow">
            {c.operationName} · vs {FACTION_LABEL[c.faction]}
          </div>
          <h1 className="h-display text-[44px] sm:text-[60px]">
            Operation complete
          </h1>
        </div>
      </div>
      <p className="text-text-2 mt-3 text-[17px]">
        Your squad finished all {c.rules.missionsPerOperation} missions of{" "}
        {c.operationName}. Keep the streak going with a new operation, or stand
        down and put this run in the hall of fame.
      </p>
      <div className="mt-8 grid md:grid-cols-2 gap-4">
        <button
          className="choice-card !border-yellow"
          onClick={() => apply((x) => nextOperation(x))}
        >
          <div className="h-display text-[34px] sm:text-[42px] leading-tight text-yellow">
            Continue to the {ordinal(c.operation + 1)} Operation
          </div>
          <div className="text-[15px] text-text-2 mt-2">
            A new briefing: choose the front and difficulty. Everyone keeps
            their Requisition.
          </div>
          <div className="choice-cta">Continue →</div>
        </button>
        <button className="choice-card" onClick={() => setConfirmEnd(true)}>
          <div className="h-display text-[34px] sm:text-[42px] leading-tight">
            Stand down
          </div>
          <div className="text-[15px] text-text-2 mt-2">
            End the run here with {ops} completed and record it in the hall of
            fame.
          </div>
          <div className="choice-cta">Stand down →</div>
        </button>
      </div>

      <section className="mt-10">
        <div className="font-display font-bold uppercase tracking-wider text-[18px]">
          Current resources
        </div>
        <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {activeDivers(c).map((d) => (
            <div key={d.id} className="panel p-4">
              <div
                className="h-display text-[22px]"
                style={{ color: DIVER_COLORS[d.color] }}
              >
                {d.name}
              </div>
              <Req
                value={d.balance}
                size={20}
                className="font-display font-bold text-[26px] text-req mt-1"
              />
              <div className="h-1.5 mt-2 bg-req/10">
                <div
                  className="h-full bg-req"
                  style={{
                    width: `${(d.balance / c.rules.maxBalance) * 100}%`,
                  }}
                />
              </div>
              <div className="text-[12px] text-muted mt-1">
                of {req(c.rules.maxBalance)} max
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[13.5px] text-muted">
          {ops} completed · {score.missions} missions · {req(score.totalEarned)}{" "}
          Requisition earned · {req(score.totalSpent)} spent on gear
        </div>
      </section>

      <Modal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="Stand down?"
      >
        <p className="text-text-2">
          Your squad retires with {ops} completed. The run goes into the hall of
          fame.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            data-autofocus
            className="btn btn-ghost"
            onClick={() => setConfirmEnd(false)}
          >
            Keep fighting
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              setConfirmEnd(false);
              apply((x) =>
                endCampaign(x, `The squad stood down after ${ops}.`),
              );
            }}
          >
            Stand down
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function GameOver() {
  const { campaign: c } = useCampaign();
  if (!c) return null;
  const score = scoreCampaign(c);
  const winner = c.winnerId ? c.divers.find((d) => d.id === c.winnerId) : null;
  const mvp = [...c.divers].sort(
    (a, b) =>
      b.stats.missions - a.stats.missions || b.stats.profit - a.stats.profit,
  )[0];
  return (
    <div className="rise text-center max-w-3xl mx-auto py-6">
      <Emblem size={84} className="mx-auto" />
      <div className="eyebrow text-yellow mt-6">{c.operationName}</div>
      <h1 className="h-display text-[56px] sm:text-[72px]">
        {winner ? `${winner.name} wins` : "Campaign over"}
      </h1>
      <p className="text-text-2 text-[17px]">{c.endedReason}</p>
      <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
        {[
          ["Missions", score.missions.toString()],
          [
            c.mode === "operations" ? "Operations done" : "Rounds",
            (c.mode === "operations"
              ? score.operationsCompleted
              : score.roundsSurvived
            ).toString(),
          ],
          ["Requisition earned", req(score.totalEarned)],
          ["Spent on gear", req(score.totalSpent)],
        ].map(([k, v]) => (
          <div key={k} className="panel px-4 py-3">
            <div className="eyebrow">{k}</div>
            <div className="font-display font-bold text-[26px]">{v}</div>
          </div>
        ))}
      </div>
      {mvp && c.divers.length > 1 && (
        <div className="mt-4 text-muted">
          Longest service:{" "}
          <span style={{ color: DIVER_COLORS[mvp.color] }}>{mvp.name}</span> (
          {mvp.stats.missions} missions, net {mvp.stats.profit >= 0 ? "+" : "−"}
          {req(Math.abs(mvp.stats.profit))})
        </div>
      )}
      <div className="mt-8 flex gap-3 justify-center flex-wrap">
        <button
          className="btn btn-primary btn-lg"
          onClick={() => store.archiveCampaign(c)}
        >
          Record & start a new campaign
        </button>
        <Link href="/market/" className="btn btn-ghost btn-lg">
          See the market you shaped
        </Link>
      </div>
    </div>
  );
}

export function CampaignHud() {
  const { campaign: c, app } = useCampaign();
  if (!c) return null;
  const isOps = c.mode === "operations";
  return (
    <aside className="panel p-4 space-y-4 text-[14px]">
      <div>
        <div className="eyebrow">{isOps ? "Operations" : "Budget Blitz"}</div>
        <div className="font-display font-bold uppercase tracking-wider text-[18px] leading-tight">
          {c.operationName}
        </div>
        <div className="text-[12px] text-muted mt-0.5">
          Squad code{" "}
          <span className="font-mono text-text-2">{c.squadCode}</span> · local
          only
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="panel-flat px-3 py-2">
          <div className="eyebrow">{isOps ? "Operation" : "Round"}</div>
          <div className="font-display font-bold text-[20px]">
            {isOps
              ? `${c.operation} · ${c.missionInOp}/${c.rules.missionsPerOperation}`
              : c.round}
          </div>
        </div>
        <div className="panel-flat px-3 py-2">
          <div className="eyebrow">Missions</div>
          <div className="font-display font-bold text-[20px]">
            {c.log.length}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <FactionEmblem faction={c.faction} size={22} />
        <span>{FACTION_LABEL[c.faction]}</span>
        <span className="text-muted">· {DIFFICULTY_NAMES[c.difficulty]}</span>
      </div>
      <div className="space-y-2.5">
        {c.divers.map((d) => (
          <div key={d.id}>
            <div className="flex items-center justify-between">
              <span
                style={{
                  color:
                    d.status === "active"
                      ? DIVER_COLORS[d.color]
                      : "var(--dim)",
                }}
                className={d.status === "active" ? "" : "line-through"}
              >
                {d.name}
              </span>
              <span className="tnum text-text-2">
                {isOps
                  ? req(d.balance)
                  : `${d.stats.profit >= 0 ? "+" : "−"}${req(Math.abs(d.stats.profit))}`}
              </span>
            </div>
            {isOps && (
              <div className="h-1.5 mt-1 bg-req/10">
                <div
                  className="h-full"
                  style={{
                    width: `${(d.balance / c.rules.maxBalance) * 100}%`,
                    background:
                      d.status === "active"
                        ? DIVER_COLORS[d.color]
                        : "var(--dim)",
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="pt-3 border-t border-line text-[12.5px] text-muted">
        Market day #{app.market.day}. Prices update once a day
        {__DEV_TOOLS__ && (
          <>
            {" "}
            <span className="text-dim">
              (dev build:{" "}
              <button
                className="text-yellow hover:underline font-mono"
                onClick={() => openTerminal("update")}
              >
                update
              </button>{" "}
              in the terminal)
            </span>
          </>
        )}
        .
      </div>
    </aside>
  );
}

export function MissionLog() {
  const { campaign: c } = useCampaign();
  if (!c || !c.log.length) return null;
  return (
    <div className="panel mt-6 overflow-x-auto">
      <div className="px-5 pt-4 font-display font-bold uppercase tracking-wider">
        Mission log
      </div>
      <table className="w-full text-[13.5px] mt-2">
        <thead className="text-muted text-left">
          <tr>
            {[
              "#",
              "Front",
              "Diff",
              "Helldiver",
              "Loadout",
              "Spent",
              "Earned",
              "Reinf.",
              c.mode === "operations" ? "Balance" : "Profit",
            ].map((h) => (
              <th
                key={h}
                className="px-3 py-1.5 font-display uppercase tracking-wider text-[12px]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...c.log].reverse().flatMap((m) =>
            m.divers.map((d, k) => (
              <tr
                key={`${m.n}-${d.id}`}
                className={k === 0 ? "border-t border-line" : ""}
              >
                <td className="px-3 py-1 text-muted">{k === 0 ? m.n : ""}</td>
                <td className="px-3 py-1">
                  {k === 0 ? FACTION_LABEL[m.faction] : ""}
                </td>
                <td className="px-3 py-1 text-muted">
                  {k === 0 ? m.difficulty : ""}
                </td>
                <td className="px-3 py-1">{d.name}</td>
                <td className="px-3 py-1 text-muted max-w-[320px] truncate">
                  {d.items.map((i) => ITEMS[i].name).join(", ")}
                </td>
                <td className="px-3 py-1 tnum">{req(d.total)}</td>
                <td className="px-3 py-1 tnum">{req(d.earned)}</td>
                <td className="px-3 py-1 tnum">{d.deaths}</td>
                <td
                  className={`px-3 py-1 tnum ${d.status !== "active" ? "text-bad" : ""}`}
                >
                  {c.mode === "operations"
                    ? req(d.balanceAfter)
                    : `${d.profit >= 0 ? "+" : "−"}${req(Math.abs(d.profit))}`}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}
