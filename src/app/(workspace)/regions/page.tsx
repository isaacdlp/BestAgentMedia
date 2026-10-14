import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { RegionsWorkspace } from "./regions-workspace";

export default async function RegionsPage() {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }
  return <RegionsWorkspace />;
}
