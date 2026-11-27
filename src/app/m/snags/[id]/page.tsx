import { notFound } from "next/navigation";
import { z } from "zod";
import { SnagDetailPage } from "@/components/snagPages";

export const metadata = { title: "Snag" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  return <SnagDetailPage base="/m" id={id} />;
}
