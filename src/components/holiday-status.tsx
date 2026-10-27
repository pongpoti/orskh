import { Notice } from "@/components/auth-shell";
import { thaiDate } from "@/lib/days";
import type { HolidayFeed } from "@/lib/holidays";

const FALLBACK = "จนกว่าจะแก้ ห้องผ่าตัดจะปิดเฉพาะวันเสาร์-อาทิตย์และวันที่ตั้งไว้ใน EXTRA_HOLIDAYS";

/** The next holiday from the Bank of Thailand calendar, or, when BOT_API_TOKEN does not work, why not. */
export function HolidayStatus({ feed, today }: { feed: HolidayFeed; today: string }) {
  const year = Number(today.slice(0, 4)) + 543;
  const next =
    feed.state === "ok" ? [...feed.holidays].sort((a, b) => a.date.localeCompare(b.date)).find((holiday) => holiday.date >= today) : undefined;

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="holiday-status-title">
      <h2 id="holiday-status-title" className="text-base font-bold text-ink sm:text-lg">
        ปฏิทินวันหยุด
      </h2>
      <p className="text-sm text-muted">วันหยุดราชการและวันหยุดพิเศษจากธนาคารแห่งประเทศไทย</p>
      {feed.state === "ok" && feed.holidays.length > 0 ? (
        <dl className="mt-3 rounded-xl border border-line bg-white/70 px-4 py-3 text-sm">
          <dt className="text-muted">วันหยุดถัดไป</dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {next ? (
              <>
                <time dateTime={next.date}>{thaiDate(next.date)}</time>
                <span className="block font-normal text-ink-2">{next.name}</span>
              </>
            ) : (
              `ไม่มีวันหยุดเหลือในปี ${year}`
            )}
          </dd>
        </dl>
      ) : (
        <Notice tone="warning" role="status" className="mt-3">
          {feed.state === "ok"
            ? `เชื่อมต่อได้ แต่ไม่พบรายการวันหยุดของปี ${year}`
            : feed.state === "no-token"
              ? "ยังไม่ได้ตั้งค่า BOT_API_TOKEN ใน Vercel"
              : feed.status === 401 || feed.status === 403
                ? `ธนาคารแห่งประเทศไทยไม่รับ BOT_API_TOKEN นี้ (รหัส ${feed.status}) ตรวจสอบค่าใน Vercel แล้ว Redeploy`
                : `${feed.status ? `ธนาคารแห่งประเทศไทยตอบกลับรหัส ${feed.status}` : "ติดต่อธนาคารแห่งประเทศไทยไม่ได้"} ลองเปิดหน้านี้ใหม่ภายหลัง`}{" "}
          {FALLBACK}
        </Notice>
      )}
    </section>
  );
}
