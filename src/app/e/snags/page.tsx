import { SnagsIndex } from "@/components/snagPages";

export const metadata = { title: "Snags" };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; project?: string }> }) {
  return <SnagsIndex base="/e" sp={await searchParams} />;
}
