"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Sparkles, 
  Plus, 
  Inbox, 
  Zap, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  X,
  FileCheck2,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { cn } from "@/lib/cn";

type MatchStatusResult = {
  matched: boolean;
  n?: string;
  company?: string;
  title?: string;
  score?: string | null;
  status?: string;
  reportHref?: string;
  hasTailoredCv?: boolean;
  hasTailoredCover?: boolean;
  inInbox?: boolean;
};

export function AddRoleBar({ className }: { className?: string }) {
  const router = useRouter();
  const { startJob } = useJobs();
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [matchStatus, setMatchStatus] = useState<MatchStatusResult | null>(null);
  const [checking, setChecking] = useState(false);
  const checkTimeout = useRef<NodeJS.Timeout | null>(null);

  // Debounced match check on URL change
  useEffect(() => {
    if (checkTimeout.current) clearTimeout(checkTimeout.current);
    const trimmed = url.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      setMatchStatus(null);
      setChecking(false);
      return;
    }

    setChecking(true);
    checkTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/apply/match-status?url=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = (await res.json()) as MatchStatusResult;
          setMatchStatus(data);
        } else {
          setMatchStatus(null);
        }
      } catch {
        setMatchStatus(null);
      } finally {
        setChecking(false);
      }
    }, 350);

    return () => {
      if (checkTimeout.current) clearTimeout(checkTimeout.current);
    };
  }, [url]);

  const handleCheckMatch = () => {
    const trimmed = url.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      setMessage({ text: "Please enter a valid job URL (starts with https://)", type: "error" });
      return;
    }

    const companyGuess = matchStatus?.company || "";
    const titleGuess = matchStatus?.title || "Evaluating fit against your CV";

    startJob({
      title: companyGuess ? `Score · ${companyGuess}` : "Score · Job Posting",
      subtitle: titleGuess,
      kind: "evaluate",
      input: trimmed,
      page: "/pipeline",
    });

    setMessage({
      text: "Evaluation worker started! You can watch the scoring progress live in the job tracker.",
      type: "success",
    });
    setUrl("");
    setMatchStatus(null);
  };

  const handleAddToInbox = async () => {
    const trimmed = url.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      setMessage({ text: "Please enter a valid job URL (starts with https://)", type: "error" });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/explore/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offers: [{ url: trimmed, source: "shared" }],
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setMessage({ text: data.error || "Failed to add role to inbox.", type: "error" });
      } else {
        setMessage({ text: "Role added to your inbox! Refreshing...", type: "success" });
        setUrl("");
        setMatchStatus(null);
        router.refresh();
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Error adding to inbox", type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("rounded-2xl border border-border/80 bg-surface/60 p-3.5 backdrop-blur-md shadow-sm transition-all", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-3.5 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/15 max-sm:min-h-[44px]"
          >
            <Plus className="size-3.5" />
            Check Match / Add Role
            {isOpen ? <ChevronUp className="size-3.5 ml-0.5" /> : <ChevronDown className="size-3.5 ml-0.5" />}
          </button>
          <span className="text-xs text-muted max-sm:hidden">
            Have a job link shared by someone? Paste it here to score fit or add to pipeline.
          </span>
        </div>
      </div>

      {isOpen && (
        <div className="mt-3.5 space-y-3 pt-3 border-t border-border/60">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCheckMatch();
                }
              }}
              placeholder="Paste job link (Ashby, Greenhouse, Lever, LinkedIn, company careers...)"
              className="min-w-[280px] flex-1 rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20 placeholder:text-faint"
            />
            <button
              type="button"
              onClick={handleCheckMatch}
              disabled={busy || !url.trim()}
              title="Runs AI evaluation worker to score fit (1-5), analyze gaps, and create report in pipeline"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-brand-foreground shadow-sm transition hover:bg-brand-200 disabled:opacity-50"
            >
              <Sparkles className="size-4" />
              Check Match
              <CostBadge kind="spend" size="xs" />
            </button>
            <button
              type="button"
              onClick={handleAddToInbox}
              disabled={busy || !url.trim()}
              title="Add to inbox triage without spending AI tokens"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted transition hover:border-brand/40 hover:text-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Inbox className="size-4" />}
              Add to Inbox (Free)
            </button>
            {url.trim() && (
              <Link
                href={`/apply?url=${encodeURIComponent(url.trim())}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-sm font-medium text-amber-600 transition hover:bg-amber-500/20 dark:text-amber-400"
                title="Open fast Playwright direct apply form"
              >
                <Zap className="size-4" />
                Direct Apply
              </Link>
            )}
          </div>

          {/* Real-time Match Status Preview */}
          {checking && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="size-3 animate-spin text-brand" />
              Checking if role is already tracked or evaluated…
            </div>
          )}

          {matchStatus && matchStatus.matched && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                <span className="font-medium text-foreground">
                  Already Evaluated #{matchStatus.n}: {matchStatus.company} — {matchStatus.title}
                </span>
                {matchStatus.score && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                    Fit {matchStatus.score}
                  </span>
                )}
                {matchStatus.hasTailoredCv && (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <FileCheck2 className="size-3" /> Tailored CV Ready
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {matchStatus.reportHref && (
                  <Link
                    href={matchStatus.reportHref}
                    className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                  >
                    View Report <ExternalLink className="size-3" />
                  </Link>
                )}
                <Link
                  href={`/apply?url=${encodeURIComponent(url.trim())}&n=${matchStatus.n}&company=${encodeURIComponent(matchStatus.company || "")}`}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-white hover:bg-emerald-700 font-medium"
                >
                  Apply Now
                </Link>
              </div>
            </div>
          )}

          {matchStatus && !matchStatus.matched && matchStatus.inInbox && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Inbox className="size-3.5 text-brand" />
              This role is already in your <Link href="/pipeline?tab=INBOX" className="text-brand underline">Inbox</Link> awaiting triage or evaluation.
            </div>
          )}

          {message && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs",
                message.type === "success" && "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                message.type === "error" && "border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
                message.type === "info" && "border border-brand/30 bg-brand-soft text-brand"
              )}
            >
              {message.type === "success" && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
              {message.type === "error" && <AlertCircle className="size-4 shrink-0 text-red-500" />}
              <span>{message.text}</span>
              <button
                type="button"
                onClick={() => setMessage(null)}
                className="ml-auto text-faint hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
