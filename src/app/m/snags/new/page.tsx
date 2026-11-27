import { SnagNew } from "@/components/snagPages";

export const metadata = { title: "Log a snag" };

export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  return <SnagNew base="/m" sp={await searchParams} />;
}
