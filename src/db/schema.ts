import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const staffRegistrations = pgTable("staff_registrations", {
  lineUserId: text("line_user_id").primaryKey(),
  lineDisplayName: text("line_display_name"),
  job: text("job").notNull(),
  physicianId: text("physician_id"),
  physicianName: text("physician_name"),
  specialty: text("specialty"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The admin's surgeon list (drizzle/0001_surgeons.sql). Names are unique; the specialty is a department code. */
export const surgeons = pgTable("surgeons", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique("surgeons_name_key"),
  specialty: text("specialty").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
