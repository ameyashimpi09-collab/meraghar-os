import { NextResponse, type NextRequest } from "next/server";

// Quick gate: no session cookie -> send to login. The real permission
// checks happen on the server and in the database for every request.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("mg_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/m/:path*", "/e/:path*", "/c/:path*"] };
