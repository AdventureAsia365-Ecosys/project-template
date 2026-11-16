// Request proxy (Next.js 16; was middleware.ts): refuses cross-site writes before any route handler runs.
import { NextResponse, type NextRequest } from "next/server";
import { checkCrossSiteWrite } from "./lib/crossSite.ts";

export function proxy(request: NextRequest) {
  const check = checkCrossSiteWrite(request.method, request.url, request.headers);
  if (!check.allowed) {
    return NextResponse.json({ error: "cross-site write refused" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
