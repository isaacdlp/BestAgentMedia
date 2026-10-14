import "server-only";
import type { SessionOptions } from "iron-session";
import { z } from "zod";

export type SessionData = {
  userId?: string;
  authVersion?: number;
};

const passwordSchema = z.string().min(32);

export function getSessionOptions(): SessionOptions {
  const password = passwordSchema.parse(process.env.SESSION_PASSWORD);

  return {
    cookieName: "bestagentmedia_session",
    password,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    },
  };
}
