import fs from "node:fs";
import * as yaml from "js-yaml";
import { chromium, type Browser, type Page } from "playwright-core";
import { careerOpsRoot, findApplicationByUrl } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { resolveSessionCv } from "@/lib/apply/cv";
import { resolveSessionCover } from "@/lib/apply/cover";
import { assertSafeApplyUrl } from "@/lib/apply/url-guard.mjs";
import { normalizeToApplicationUrl } from "./url-normalize.mjs";

export { normalizeToApplicationUrl };

export type DirectFillParams = {
  url: string;
  company?: string;
  application?: string;
  title?: string;
  answers?: Record<string, string>;
  fields?: Array<{ id: string; label?: string; name?: string; type?: string }>;
};

export type DirectFillResult = {
  ok: boolean;
  message: string;
  filledFields: string[];
  cvAttached: boolean;
  coverAttached: boolean;
  targetUrl: string;
  cvPath?: string;
  coverPath?: string;
  error?: string;
};

export type CandidateProfile = {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  website: string;
  github: string;
  nationality: string;
  workAuth: string;
  targetSalaryMonthlyUsd: string;
};

// Global set to keep browser instances alive while user inspects and submits
declare global {
  // eslint-disable-next-line no-var
  var __coDirectBrowsers: Set<Browser> | undefined;
}
const DIRECT_BROWSERS: Set<Browser> = (globalThis.__coDirectBrowsers ??= new Set());

/** Escape a value for use inside a double-quoted CSS attribute selector. */
function cssAttr(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}


export function loadCandidateProfile(): CandidateProfile {
  const root = careerOpsRoot();
  const profileFile = getProfilePath(root);
  let parsed: Record<string, unknown> = {};
  if (fs.existsSync(/*turbopackIgnore: true*/ profileFile)) {
    try {
      parsed = (yaml.load(fs.readFileSync(/*turbopackIgnore: true*/ profileFile, "utf8")) as Record<string, unknown>) || {};
    } catch {
      // fallback to defaults below
    }
  }

  const c = (parsed.candidate as Record<string, string> | undefined) || {};
  const fullName = c.full_name || "Applicant";
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || "Applicant";
  const lastName = parts.slice(1).join(" ") || "";

  let linkedin = c.linkedin || "https://linkedin.com/in/applicant";
  if (linkedin && !linkedin.startsWith("http")) linkedin = `https://${linkedin}`;

  let github = c.github || "https://github.com/applicant";
  if (github && !github.startsWith("http")) github = `https://${github}`;

  let website = c.website || "https://example.com";
  if (website && !website.startsWith("http")) website = `https://${website}`;

  return {
    name: fullName,
    firstName,
    lastName,
    email: c.email || "applicant@example.com",
    phone: c.phone || "+1234567890",
    location: c.location || "Remote",
    linkedin,
    website,
    github,
    nationality: c.nationality || "Authorized to work",
    workAuth: c.work_auth || "Authorized to work (no sponsorship required)",
    targetSalaryMonthlyUsd: c.target_salary || "",
  };
}

async function tryFill(page: Page, selectors: string[], value: string): Promise<boolean> {
  if (!value) return false;
  for (const fr of page.frames()) {
    for (const sel of selectors) {
      try {
        const el = fr.locator(sel).first();
        if ((await el.count()) > 0 && (await el.isVisible().catch(() => true))) {
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await el.fill(value);
          return true;
        }
      } catch {
        // continue
      }
    }
  }
  return false;
}

/**
 * Searches page labels and associated input fields by regex pattern.
 * Uses safe attribute selector [id="..."] avoiding CSS numeric ID syntax errors.
 */
async function tryFillByLabel(page: Page, labelPattern: RegExp, value: string): Promise<boolean> {
  if (!value) return false;
  for (const fr of page.frames()) {
    try {
      const match = await fr.evaluate((pattern) => {
        const re = new RegExp(pattern, "i");
        const candidates = Array.from(document.querySelectorAll("label, [class*='label' i], [class*='field' i], div[class*='header' i]"));
        for (const lab of candidates) {
          const txt = lab.textContent || "";
          if (re.test(txt)) {
            const forId = lab.getAttribute("for");
            if (forId) {
              const el = document.getElementById(forId);
              if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
                return { id: forId };
              }
            }
            const input = lab.querySelector("input:not([type='hidden']), textarea, select");
            if (input) {
              if (input.id) return { id: input.id };
              const name = input.getAttribute("name");
              if (name) return { name };
            }
            const container = lab.closest("div");
            if (container) {
              const cInput = container.querySelector("input:not([type='hidden']), textarea, select");
              if (cInput) {
                if (cInput.id) return { id: cInput.id };
                const name = cInput.getAttribute("name");
                if (name) return { name };
              }
            }
          }
        }
        return null;
      }, labelPattern.source);

      if (match) {
        const sel = match.id ? `[id="${cssAttr(match.id)}"]` : `[name="${cssAttr(match.name!)}"]`;
        const el = fr.locator(sel).first();
        if ((await el.count()) > 0) {
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await el.fill(value);
          return true;
        }
      }
    } catch {
      // continue
    }
  }
  return false;
}

async function tryClickLabel(page: Page, text: string): Promise<boolean> {
  for (const fr of page.frames()) {
    try {
      const el = fr.locator(`label:has-text("${text}")`).first();
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => true))) {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click();
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}

async function tryUpload(page: Page, selectors: string[], filePath: string): Promise<boolean> {
  if (!filePath || !fs.existsSync(/*turbopackIgnore: true*/ filePath)) return false;
  for (const fr of page.frames()) {
    for (const sel of selectors) {
      try {
        const el = fr.locator(sel).first();
        if ((await el.count()) > 0) {
          await el.setInputFiles(filePath);
          return true;
        }
      } catch {
        // continue
      }
    }
  }
  return false;
}

async function countFormFields(page: Page): Promise<number> {
  let total = 0;
  for (const fr of page.frames()) {
    try {
      const count = await fr.evaluate(() => {
        return document.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]').length;
      });
      total += count;
    } catch {}
  }
  return total;
}

/**
 * Ensures the actual application form is active and revealed.
 * If the page is on a Job Description without form fields, detects and follows
 * the "Application" tab or "Apply for this Job" links/buttons.
 */
async function ensureApplicationFormRevealed(page: Page): Promise<boolean> {
  if ((await countFormFields(page)) >= 2) return true;

  // 1) First check: links pointing to application or apply
  for (const fr of page.frames()) {
    try {
      const appLink = fr.locator('a[href*="/application"], a[href*="/apply"], a[href*="#app"]').first();
      if ((await appLink.count()) > 0 && (await appLink.isVisible().catch(() => true))) {
        const href = await appLink.getAttribute("href");
        if (href) {
          const target = new URL(href, page.url()).toString();
          if (target !== page.url()) {
            await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
            await page.waitForLoadState("load", { timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(1000);
            if ((await countFormFields(page)) >= 2) return true;
          }
        }
      }
    } catch {}
  }

  // 2) Look for "Application" tab or "Apply for this Job" button/tab
  for (const fr of page.frames()) {
    try {
      const trigger = fr.locator([
        '[role="tab"]:has-text("Application")',
        'a:has-text("Application")',
        'button:has-text("Application")',
        'a:has-text("Apply for this Job")',
        'button:has-text("Apply for this Job")',
        'a:has-text("Apply now")',
        'button:has-text("Apply now")',
        'button:has-text("Apply")',
        'a:has-text("Apply")',
      ].join(", ")).first();

      if ((await trigger.count()) > 0 && (await trigger.isVisible().catch(() => true))) {
        await trigger.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1500);
        if ((await countFormFields(page)) >= 2) return true;
      }
    } catch {}
  }

  return (await countFormFields(page)) >= 2;
}

/**
 * Direct Playwright Form Filling:
 * Opens a visible browser, navigates to the target application form,
 * auto-detects and reveals Application tabs if given a JD URL,
 * populates candidate details, attaches CV & Cover Letter PDFs in seconds,
 * and leaves the browser open in front for the human to review and submit.
 *
 * SAFETY INVARIANT: NEVER clicks submit. Halts and hands off to user.
 */
export async function directFillApplication(params: DirectFillParams): Promise<DirectFillResult> {
  // Normalize JD URLs to Application form URLs upfront
  const targetUrl = normalizeToApplicationUrl(params.url);
  await assertSafeApplyUrl(targetUrl);

  const matched = !params.application && params.url ? findApplicationByUrl(params.url) : null;
  const application = params.application || matched?.n;
  const company = params.company || matched?.company;

  const candidate = loadCandidateProfile();
  const cvPath = (await resolveSessionCv({ company, application, title: params.title, url: params.url, allowFallback: true })) ?? undefined;
  const coverPath = (await resolveSessionCover({ company, application, title: params.title, url: params.url })) ?? undefined;

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: false,
      channel: "chrome",
      args: ["--start-maximized"],
    });
  } catch {
    browser = await chromium.launch({
      headless: false,
      args: ["--start-maximized"],
    });
  }

  DIRECT_BROWSERS.add(browser);
  browser.on("disconnected", () => {
    DIRECT_BROWSERS.delete(browser);
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
    await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);
  } catch (e) {
    return {
      ok: false,
      message: `Failed to load ${targetUrl}: ${e instanceof Error ? e.message : "Navigation error"}`,
      filledFields: [],
      cvAttached: false,
      coverAttached: false,
      targetUrl,
      error: e instanceof Error ? e.message : "Navigation error",
    };
  }

  // Dismiss cookie/consent dialogs if visible
  for (const fr of page.frames()) {
    try {
      const consentBtn = fr.locator('button:has-text("Accept"), button:has-text("Allow"), button:has-text("I Agree"), button:has-text("Aceptar")').first();
      if ((await consentBtn.count()) > 0 && (await consentBtn.isVisible())) {
        await consentBtn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    } catch {
      // ignore
    }
  }

  // If the page is still showing the Job Description, reveal the Application tab/view
  await ensureApplicationFormRevealed(page);

  const filledFields: string[] = [];

  // 1. Full Name / First Name / Last Name
  const filledFullName = await tryFill(
    page,
    ['input[name="_systemfield_name"]', 'input[name="name"]', 'input[name*="full_name" i]', 'input[autocomplete="name"]', 'input[id*="name" i]'],
    candidate.name,
  );
  if (filledFullName) {
    filledFields.push("Full Name");
  } else {
    const filledFirst = await tryFill(
      page,
      ['input[name*="first_name" i]', 'input[name*="firstName" i]', 'input[autocomplete="given-name"]'],
      candidate.firstName,
    );
    const filledLast = await tryFill(
      page,
      ['input[name*="last_name" i]', 'input[name*="lastName" i]', 'input[autocomplete="family-name"]'],
      candidate.lastName,
    );
    if (filledFirst || filledLast) filledFields.push("First & Last Name");
  }

  // 2. Email Address
  if (
    await tryFill(
      page,
      ['input[name="_systemfield_email"]', 'input[name="email"]', 'input[type="email"]', 'input[name*="email" i]', 'input[autocomplete="email"]'],
      candidate.email,
    )
  ) {
    filledFields.push("Email Address");
  }

  // 3. Phone Number
  if (
    await tryFill(
      page,
      ['input[name="_systemfield_phone"]', 'input[name="phone"]', 'input[type="tel"]', 'input[name*="phone" i]', 'input[autocomplete="tel"]'],
      candidate.phone,
    )
  ) {
    filledFields.push("Phone Number");
  }

  // 4. LinkedIn Profile
  const filledLinkedIn =
    (await tryFill(
      page,
      [
        'input[name="question_7082919101"]', // Ziina specific
        'input[name="16dbd152-38dd-4a69-a6ae-e6be77944343"]', // AlgoDriven specific
        'input[placeholder*="linkedin" i]',
        'input[aria-label*="linkedin" i]',
        'input[name*="linkedin" i]',
        'input[id*="linkedin" i]',
      ],
      candidate.linkedin,
    )) || (await tryFillByLabel(page, /linkedin/i, candidate.linkedin));

  if (filledLinkedIn) {
    filledFields.push("LinkedIn Profile");
  }

  // 5. Website / GitHub / Portfolio
  const filledWebsite =
    (await tryFill(
      page,
      [
        'input[name="question_7082920101"]', // Ziina specific
        'input[placeholder*="github" i]',
        'input[placeholder*="website" i]',
        'input[placeholder*="portfolio" i]',
        'input[aria-label*="website" i]',
        'input[aria-label*="github" i]',
        'input[name*="website" i]',
        'input[name*="github" i]',
        'input[name*="portfolio" i]',
      ],
      candidate.website,
    )) || (await tryFillByLabel(page, /github|website|portfolio/i, candidate.website));

  if (filledWebsite) {
    filledFields.push("Website / GitHub");
  }

  // 6. Location / City
  const filledLocation =
    (await tryFill(
      page,
      ['input[placeholder*="location" i]', 'input[placeholder*="city" i]', 'input[name*="location" i]', 'input[name*="city" i]'],
      candidate.location,
    )) || (await tryFillByLabel(page, /^location$|^city$/i, candidate.location));

  if (filledLocation) {
    filledFields.push("Location");
  }

  // 7. Work Authorization / Visa Status
  const filledVisa =
    (await tryFill(
      page,
      [
        'input[name*="visa" i]',
        'input[placeholder*="visa" i]',
        'input[name*="sponsorship" i]',
        'input[placeholder*="sponsorship" i]',
        'input[name*="authorized" i]',
      ],
      candidate.nationality,
    )) || (await tryFillByLabel(page, /visa|sponsorship|authorized to work|work authorization/i, candidate.workAuth));

  if (filledVisa) {
    filledFields.push("Visa / Work Authorization");
  }

  // 8. Salary / Compensation expectations
  const filledSalary = await tryFillByLabel(
    page,
    /salary|compensation|expected.*salary/i,
    candidate.targetSalaryMonthlyUsd,
  );
  if (filledSalary) {
    filledFields.push("Salary Expectations");
  }

  // 9. Apply explicit answers passed in (e.g. from UI proxy)
  if (params.answers) {
    for (const [key, val] of Object.entries(params.answers)) {
      if (!val) continue;
      // Skip file fields (handled by PDF upload)
      if (key.includes("resume") || key.includes("cv") || key.includes("cover")) continue;
      const strVal = String(val);
      for (const fr of page.frames()) {
        try {
          const loc = fr.locator(`[data-co-field="${cssAttr(key)}"], [name="${cssAttr(key)}"], [id="${cssAttr(key)}"]`).first();
          if ((await loc.count()) > 0) {
            const tagName = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
            const type = await loc.getAttribute("type").catch(() => "");
            if (type === "checkbox") {
              const want = ["true", "1", "yes", "on", "checked"].includes(strVal.toLowerCase());
              await loc.setChecked(want).catch(() => {});
            } else if (tagName === "select") {
              await loc.selectOption({ label: strVal }).catch(async () => {
                await loc.selectOption(strVal);
              });
            } else {
              await loc.fill(strVal);
            }
            filledFields.push(`Custom: ${key}`);
            break;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // 11. Upload CV PDF
  let cvAttached = false;
  if (cvPath && fs.existsSync(/*turbopackIgnore: true*/ cvPath)) {
    cvAttached = await tryUpload(
      page,
      [
        'input[name="_systemfield_resume"]',
        "input#_systemfield_resume",
        'input[type="file"][name*="resume" i]',
        'input[type="file"][id*="resume" i]',
        'input[type="file"][aria-label*="resume" i]',
        'input[type="file"]', // fallback if single file input
      ],
      cvPath,
    );
    if (cvAttached) {
      filledFields.push("CV PDF Attached");
      await page.waitForTimeout(600);
    }
  }

  // 12. Upload Cover Letter PDF
  let coverAttached = false;
  if (coverPath && fs.existsSync(/*turbopackIgnore: true*/ coverPath)) {
    coverAttached = await tryUpload(
      page,
      [
        "input#cover_letter",
        'input[name*="cover" i]',
        'input[type="file"][name*="cover" i]',
        'input[type="file"][id*="cover" i]',
        'input[type="file"][aria-label*="cover" i]',
      ],
      coverPath,
    );
    if (coverAttached) {
      filledFields.push("Cover Letter PDF Attached");
    }
  }

  // Bring window to front
  await page.bringToFront().catch(() => {});

  // SAFETY INVARIANT: We do not submit. The browser remains open for the user.
  return {
    ok: true,
    message: "Application form opened and pre-filled with Playwright! Please review and submit when ready.",
    filledFields,
    cvAttached,
    coverAttached,
    targetUrl,
    cvPath,
    coverPath,
  };
}
