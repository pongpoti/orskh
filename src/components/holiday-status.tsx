import { Notice } from "@/components/auth-shell";
import { thaiDate } from "@/lib/days";
import type { HolidayFeed } from "@/lib/holidays";

const WEEKENDS_ONLY = "จนกว่าจะแก้ ห้องผ่าตัดจะปิดเฉพาะวันเสาร์-อาทิตย์";

/** Whether the Bank of Thailand holiday calendar answers with BOT_API_TOKEN, and the next holiday it lists. */
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
      <div className="mt-3">
        {feed.state === "ok" && feed.holidays.length > 0 ? (
          <Notice tone="success" role="status">
            เชื่อมต่อแล้ว BOT_API_TOKEN ใช้งานได้ ปี {year} มีวันหยุด {feed.holidays.length} วัน
          </Notice>
        ) : feed.state === "ok" ? (
          <Notice tone="warning" role="status">
            เชื่อมต่อได้ แต่ไม่พบรายการวันหยุดของปี {year} {WEEKENDS_ONLY}
          </Notice>
        ) : feed.state === "no-token" ? (
          <Notice tone="warning" role="status">
            ยังไม่ได้ตั้งค่า BOT_API_TOKEN ใน Vercel {WEEKENDS_ONLY}
          </Notice>
        ) : feed.status === 401 || feed.status === 403 ? (
          <Notice tone="warning" role="status">
            ธนาคารแห่งประเทศไทยไม่รับ BOT_API_TOKEN นี้ (รหัส {feed.status}) ตรวจสอบค่าใน Vercel แล้ว Redeploy {WEEKENDS_ONLY}
          </Notice>
        ) : (
          <Notice tone="warning" role="status">
            {feed.status ? `ธนาคารแห่งประเทศไทยตอบกลับรหัส ${feed.status}` : "ติดต่อธนาคารแห่งประเทศไทยไม่ได้"} ลองเปิดหน้านี้ใหม่ภายหลัง {WEEKENDS_ONLY}
          </Notice>
        )}
      </div>
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
      ) : null}
    </section>
  );
}
