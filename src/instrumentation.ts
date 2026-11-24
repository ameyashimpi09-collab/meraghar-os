// Runs once when a server starts (never during the build): bring the
// database up to date before serving pages.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureMigrations } = await import("./lib/migrate");
    if (process.env.DATABASE_URL) await ensureMigrations();
  }
}
