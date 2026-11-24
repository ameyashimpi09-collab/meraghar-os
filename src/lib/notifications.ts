import "server-only";
import type { Db } from "./db";

export async function unreadCount(db: Db): Promise<number> {
  return (await db.query("select count(*)::int as n from notifications where recipient_id = auth.uid() and read_at is null")).rows[0].n;
}

export async function myNotifications(db: Db, limit = 100) {
  return (await db.query(
    `select n.id, n.title, n.body, n.event_type, n.is_critical, n.read_at, n.created_at, n.link_path, p.name as project_name
       from notifications n left join projects p on p.id = n.project_id
      where n.recipient_id = auth.uid() order by n.created_at desc limit $1`, [limit])).rows;
}
