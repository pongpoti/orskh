export type CaseStatus =
  | "scheduled"
  | "in-progress"
  | "delayed"
  | "done"
  | "cancelled"
  | "recovery";

export type Operation = {
  id: string;
  roomId: string;
  start: string;
  end: string;
  procedure: string;
  surgeon: string;
  status: CaseStatus;
};

export type RoomMark = "active" | "delayed" | null;

type TemplateCase = Omit<Operation, "id">;

/** Fictional day list. Same shape a theatre feed would return later. */
const TEMPLATE: TemplateCase[] = [
  { roomId: "or-1", start: "08:00", end: "10:00", procedure: "ผ่าตัดไส้ติ่ง", surgeon: "นพ. ธนพล ศรีสุข", status: "done" },
  { roomId: "or-1", start: "10:30", end: "12:00", procedure: "ผ่าตัดไส้เลื่อนขาหนีบ", surgeon: "นพ. ธนพล ศรีสุข", status: "scheduled" },
  { roomId: "or-3", start: "08:30", end: "11:30", procedure: "เปลี่ยนข้อเข่าเทียมข้างขวา", surgeon: "พญ. ชนิดา มั่นคง", status: "in-progress" },
  { roomId: "or-5", start: "07:30", end: "08:30", procedure: "ผ่าตัดต้อกระจก", surgeon: "นพ. วรเมธ แสงทอง", status: "done" },
  { roomId: "or-5", start: "09:00", end: "10:00", procedure: "ผ่าตัดต้อกระจก", surgeon: "นพ. วรเมธ แสงทอง", status: "scheduled" },
  { roomId: "or-7", start: "09:00", end: "12:30", procedure: "ผ่าตัดถุงน้ำดีผ่านกล้อง", surgeon: "นพ. กิตติพงศ์ วัฒนา", status: "in-progress" },
  { roomId: "or-8", start: "13:00", end: "16:00", procedure: "ใส่เหล็กดามกระดูกสันหลัง", surgeon: "นพ. อภิชาติ บุญมี", status: "scheduled" },
  { roomId: "or-11", start: "08:00", end: "11:00", procedure: "เชื่อมกระดูกขา", surgeon: "พญ. ศิริพร เจริญผล", status: "delayed" },
  { roomId: "or-13", start: "08:00", end: "09:30", procedure: "ผ่าตัดไซนัส", surgeon: "นพ. ภาสกร นที", status: "cancelled" },
  { roomId: "or-13", start: "10:00", end: "12:00", procedure: "ผ่าตัดต่อมไทรอยด์", surgeon: "นพ. ภาสกร นที", status: "scheduled" },
  { roomId: "r-1", start: "09:40", end: "11:00", procedure: "หลังผ่าตัดไส้ติ่ง", surgeon: "นพ. ธนพล ศรีสุข", status: "recovery" },
  { roomId: "r-1", start: "10:10", end: "12:00", procedure: "หลังผ่าตัดต้อกระจก", surgeon: "นพ. วรเมธ แสงทอง", status: "recovery" },
];

export function getSchedule(date: string): Operation[] {
  return TEMPLATE.map((item, index) => ({
    ...item,
    id: `${date}-${item.roomId}-${index}`,
  }));
}

export function roomMark(operations: Operation[]): RoomMark {
  if (operations.some((item) => item.status === "in-progress" || item.status === "recovery")) {
    return "active";
  }
  if (operations.some((item) => item.status === "delayed")) return "delayed";
  return null;
}

export function casesForRoom(operations: Operation[], roomId: string): Operation[] {
  return operations
    .filter((item) => item.roomId === roomId)
    .sort((a, b) => a.start.localeCompare(b.start));
}
