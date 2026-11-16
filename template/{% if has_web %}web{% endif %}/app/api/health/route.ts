// Health of the web app: the commit it runs (GIT_SHA at build or start), for the post-deploy check.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", sha: process.env.GIT_SHA ?? "unknown" });
}
