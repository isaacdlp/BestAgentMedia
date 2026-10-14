import "server-only";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionOptions, type SessionData } from "@/lib/session";

export async function getCurrentUser() {
  const session = await getIronSession<SessionData>(
    await cookies(),
    getSessionOptions(),
  );

  if (!session.userId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      surname: true,
      phone: true,
      picturePath: true,
      role: true,
      active: true,
      authVersion: true,
    },
  });

  if (!user?.active || user.authVersion !== session.authVersion) {
    return null;
  }

  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
