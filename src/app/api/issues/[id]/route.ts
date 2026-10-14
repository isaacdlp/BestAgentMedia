import { handleAdminDelete } from "@/lib/admin-delete";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAdminDelete("issue", id);
}
