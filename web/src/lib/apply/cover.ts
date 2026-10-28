import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, findApplication, findApplicationByUrl, isRegularContainedFile, pdfPathStatusForReport } from "@/lib/career-ops";
import { companySlug } from "@/lib/company-slug.mjs";
import { hasToken, matchesTailoredCover, sortNewestFirst } from "./cv-match.mjs";
import { companyFromTitle } from "@/lib/apply/cv";
import { reportNumberFromCell } from "./cv-selection.mjs";

/** The length generate-cover-letter.mjs truncates a role slug to when it builds
 *  a default output filename (`role.slice(0, 30)`). A role longer than this is
 *  on disk only in its cut form, so both spellings are accepted below. */
const ROLE_SLUG_MAX = 30;

/**
 * Locate the tailored COVER LETTER PDF for an application. Returns an absolute
 * path or null.
 *
 * When the tracker application number is known, checks the report -> PDF manifest
 * (via pdfPathStatusForReport with kind "cover") first. If not found in manifest,
 * falls back to matching the company and role slug (or report number token) on disk.
 */
export async function resolveTailoredCover(company?: string, applicationNumber?: string): Promise<string | null> {
  const n = applicationNumber?.trim();
  const app = n ? findApplication(n) : null;
  if (n && !app) return null;

  if (app) {
    const reportNumber = reportNumberFromCell(app.report);
    if (reportNumber) {
      const result = await pdfPathStatusForReport(String(reportNumber), "cover");
      if (result.status === "found") return result.path;
    }
  }

  const key = companySlug(app?.company ?? company);
  if (!key) return null;
  const dir = path.join(careerOpsRoot(), "output");

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .filter((f) => matchesTailoredCover(f.toLowerCase(), key.slug))
      // sortNewestFirst drops directories and files that vanish under it, but
      // not a symlink PLACED in output/ that resolves elsewhere: that one stats
      // as a regular file. Same realpath guard /api/cv-pdf applies, here rather
      // than in the route so the readiness check and the served file agree.
      .filter((f) => isRegularContainedFile(path.join(dir, f), dir));
  } catch {
    return null;
  }

  if (app) {
    const role = companySlug(app.role)?.slug;
    const wanted = role ? [role, role.slice(0, ROLE_SLUG_MAX)] : [];
    const reportNum = reportNumberFromCell(app.report);
    const reportToken = reportNum ? String(reportNum).padStart(3, "0") : null;
    const roleMatches = files.filter((f) => wanted.some((r) => hasToken(f.toLowerCase(), r)));
    if (roleMatches.length > 0) {
      files = roleMatches;
    } else if (reportToken) {
      files = files.filter((f) => hasToken(f.toLowerCase(), reportToken));
    } else {
      files = [];
    }
  }

  if (!files.length) return null;
  const sorted = sortNewestFirst(dir, files);
  if (!sorted.length) return null;
  return path.join(dir, sorted[0]);
}

/**
 * The tailored Cover Letter for one apply session, resolved once for the form filler.
 */
export async function resolveSessionCover(opts: { company?: string; application?: string; title?: string; url?: string }): Promise<string | null> {
  const direct = await resolveTailoredCover(opts.company, opts.application);
  if (direct) return direct;
  if (!opts.application && opts.url) {
    const matched = findApplicationByUrl(opts.url);
    if (matched) {
      const fromUrl = await resolveTailoredCover(matched.company, matched.n);
      if (fromUrl) return fromUrl;
    }
  }
  if (opts.application) return null;
  return resolveTailoredCover(companyFromTitle(opts.title));
}
