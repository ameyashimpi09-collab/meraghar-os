import { UpdateNew } from "@/components/updatePages";

export const metadata = { title: "New site update" };

export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  return <UpdateNew base="/e" sp={await searchParams} />;
}
