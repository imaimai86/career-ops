import { directFillApplication, type DirectFillParams } from "@/lib/apply/direct-fill";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await readJsonObject<DirectFillParams>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const { url, company, application, title, answers, fields } = body;
  if (!url || typeof url !== "string") {
    return Response.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const result = await directFillApplication({
      url,
      company: typeof company === "string" ? company : undefined,
      application: typeof application === "string" ? application : undefined,
      title: typeof title === "string" ? title : undefined,
      answers,
      fields,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message.slice(0, 300) : "direct fill failed" },
      { status: 500 },
    );
  }
}
