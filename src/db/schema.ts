import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const staffRegistrations = pgTable("staff_registrations", {
  lineUserId: text("line_user_id").primaryKey(),
  lineDisplayName: text("line_display_name"),
  job: text("job").notNull(),
  physicianId: text("physician_id"),
  physicianName: text("physician_name"),
  specialty: text("specialty"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
