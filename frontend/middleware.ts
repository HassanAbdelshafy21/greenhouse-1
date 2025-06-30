import { NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function middleware(request: Request) {
  const sessionCookie = getSessionCookie(request);
  const url = new URL(request.url);
  const pathname = url.pathname;

  const publicRoutes = ["/", "/login", "/register"];
  const protectedRoutes = ["/dashboard", "/overview"];

  const isPublicRoute = publicRoutes.includes(pathname);
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  //  Unauthenticated user trying to access protected routes
  if (!sessionCookie && isProtectedRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  //Authenticated user trying to access public routes → redirect to dashboard
  if (sessionCookie && isPublicRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Unauthenticated user trying to access anything not public or protected (e.g. "/about")
  if (!sessionCookie && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|static|favicon.ico).*)"],
};