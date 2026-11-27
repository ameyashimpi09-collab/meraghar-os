import { notFound } from "next/navigation";
import { z } from "zod";
import { UpdateDetailPage } from "@/components/updatePages";

export const metadata = { title: "Site update" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  return <UpdateDetailPage base="/m" id={id} sp={await searchParams} />;
}
