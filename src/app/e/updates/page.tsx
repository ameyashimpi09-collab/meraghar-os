import { UpdatesIndex } from "@/components/updatePages";

export const metadata = { title: "Site updates" };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; project?: string }> }) {
  return <UpdatesIndex base="/e" sp={await searchParams} />;
}
