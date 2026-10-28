import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { careerOpsRoot, findApplicationByUrl, readInbox } from "@/lib/career-ops";
import { normalizeToApplicationUrl } from "@/lib/apply/url-normalize.mjs";
import { resolveTailoredCv } from "@/lib/apply/cv";
import { resolveTailoredCover } from "@/lib/apply/cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getFallbackCvPath(): string | null {
  const root = careerOpsRoot();
  const candidates = [
    path.join(root, "cv.pdf"),
    path.join(root, "output", "cv-latest.pdf"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const urlParam = req.nextUrl.searchParams.get("url")?.trim();
    if (!urlParam) {
      return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
    }

    const normalizedUrl = normalizeToApplicationUrl(urlParam);
    const app = findApplicationByUrl(normalizedUrl) || findApplicationByUrl(urlParam);

    if (app) {
      const cvPath = await resolveTailoredCv(app.company, app.n);
      const coverPath = await resolveTailoredCover(app.company, app.n);
      const fallbackCvPath = !cvPath ? getFallbackCvPath() : null;

      return NextResponse.json({
        matched: true,
        n: app.n,
        company: app.company,
        title: app.role,
        score: app.score || null,
        status: app.status || "EVALUATED",
        reportHref: `/pipeline/${app.n}`,
        hasTailoredCv: !!cvPath,
        cvPath: cvPath ?? fallbackCvPath ?? null,
        cvName: cvPath ? path.basename(cvPath) : fallbackCvPath ? path.basename(fallbackCvPath) : null,
        isFallbackCv: !cvPath && !!fallbackCvPath,
        hasTailoredCover: !!coverPath,
        coverPath: coverPath ?? null,
        coverName: coverPath ? path.basename(coverPath) : null,
      });
    }

    // Not yet evaluated in tracker: check if it is pending in inbox
    let inInbox = false;
    try {
      const inbox = readInbox();
      inInbox = inbox.some(
        (j) => j.url === urlParam || j.url === normalizedUrl || normalizeToApplicationUrl(j.url) === normalizedUrl,
      );
    } catch {
      inInbox = false;
    }
    const fallbackCv = getFallbackCvPath();

    return NextResponse.json({
      matched: false,
      inInbox,
      hasTailoredCv: false,
      cvPath: fallbackCv ?? null,
      cvName: fallbackCv ? path.basename(fallbackCv) : null,
      isFallbackCv: !!fallbackCv,
      hasTailoredCover: false,
      coverPath: null,
      coverName: null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
