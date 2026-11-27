import { UpdatesIndex } from "@/components/updatePages";

export const metadata = { title: "Site updates" };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; project?: string }> }) {
  return <UpdatesIndex base="/m" sp={await searchParams} />;
}
