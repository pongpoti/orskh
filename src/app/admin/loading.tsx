import { AdminBar } from "@/components/admin-bar";

/**
 * Shown the moment the admin link is tapped. The page itself waits for the sign-in check and the database (which
 * sleeps when idle and can take a second to wake), so without this the tap seemed to do nothing until it arrived.
 */
export default function AdminLoading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar title="จัดการรายชื่อแพทย์" />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto w-full max-w-4xl">
          <section className="card overflow-hidden" aria-busy="true" aria-labelledby="physician-list-loading">
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="physician-list-loading" className="text-base font-bold text-ink sm:text-lg">
                    รายชื่อแพทย์
                  </h2>
                  <p className="text-sm text-muted" role="status">
                    กำลังโหลด…
                  </p>
                </div>
                <span className="skeleton h-11 w-[7.5rem] shrink-0" />
              </div>
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <span className="skeleton h-11 min-w-0 flex-1" />
                <span className="skeleton h-11 sm:w-72" />
              </div>
            </div>
            <ul className="divide-y divide-line" aria-hidden>
              {Array.from({ length: 8 }, (_, index) => (
                <li key={index} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="skeleton hidden h-7 w-[5.75rem] shrink-0 rounded-full sm:block" />
                  <div className="min-w-0 flex-1 py-0.5">
                    <span className="skeleton h-4 rounded-md" style={{ width: `${[52, 44, 60, 48, 56, 40, 50, 46][index]}%` }} />
                    <span className="skeleton mt-2 h-3 w-24 rounded-md" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
