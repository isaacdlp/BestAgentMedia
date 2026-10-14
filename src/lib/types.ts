import type { getCurrentUser } from "@/lib/auth";

export type AwaitedUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
