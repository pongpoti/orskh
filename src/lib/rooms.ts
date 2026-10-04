export type RoomKind = "or" | "recovery";

export type Room = {
  id: string;
  number: string;
  kind: RoomKind;
  zone: 1 | 2;
  labelX: number;
  labelY: number;
  d: string;
};

export const ROOMS: Room[] = [
  { id: "or-1", number: "1", kind: "or", zone: 1, labelX: 221, labelY: 456.5, d: "M126 528L126 385L148 363L294 363L316 385L316 528L294 550L148 550Z" },
  { id: "or-2", number: "2", kind: "or", zone: 1, labelX: 235.5, labelY: 165.5, d: "M124 239L124 92L146 70L325 70L347 92L347 239L325 261L146 261Z" },
  { id: "or-3", number: "3", kind: "or", zone: 1, labelX: 468, labelY: 165.5, d: "M369 239L369 92L391 70L545 70L567 92L567 239L545 261L391 261Z" },
  { id: "or-4", number: "4", kind: "or", zone: 1, labelX: 769, labelY: 165.5, d: "M673 239L673 92L695 70L843 70L865 92L865 239L843 261L695 261Z" },
  { id: "or-5", number: "5", kind: "or", zone: 1, labelX: 1016, labelY: 279.5, d: "M907 353L907 206L929 184L1103 184L1125 206L1125 353L1103 375L929 375Z" },
  { id: "or-6", number: "6", kind: "or", zone: 1, labelX: 1008, labelY: 571, d: "M907 651L907 491L929 469L1087 469L1109 491L1109 651L1087 673L929 673Z" },
  { id: "or-7", number: "7", kind: "or", zone: 2, labelX: 1008, labelY: 781, d: "M907 835L907 727L929 705L1087 705L1109 727L1109 835L1087 857L929 857Z" },
  { id: "or-8", number: "8", kind: "or", zone: 2, labelX: 1008, labelY: 1042, d: "M907 1116L907 968L929 946L1087 946L1109 968L1109 1116L1087 1138L929 1138Z" },
  { id: "or-9", number: "9", kind: "or", zone: 2, labelX: 1008, labelY: 1233, d: "M907 1306L907 1160L929 1138L1087 1138L1109 1160L1109 1306L1087 1328L929 1328Z" },
  { id: "or-10", number: "10", kind: "or", zone: 2, labelX: 764, labelY: 1524, d: "M666 1600L666 1448L688 1426L840 1426L862 1448L862 1600L840 1622L688 1622Z" },
  { id: "or-11", number: "11", kind: "or", zone: 2, labelX: 473, labelY: 1524, d: "M375 1600L375 1448L397 1426L549 1426L571 1448L571 1600L549 1622L397 1622Z" },
  { id: "or-12", number: "12", kind: "or", zone: 2, labelX: 239, labelY: 1524, d: "M106 1600L106 1448L128 1426L350 1426L372 1448L372 1600L350 1622L128 1622Z" },
  { id: "or-13", number: "13", kind: "or", zone: 2, labelX: 185, labelY: 1211, d: "M52 1304L52 1118L74 1096L296 1096L318 1118L318 1304L296 1326L74 1326Z" },
  { id: "r-1", number: "1", kind: "recovery", zone: 1, labelX: 595, labelY: 615.5, d: "M433 699L433 532L757 532L757 699Z" },
  { id: "r-2", number: "2", kind: "recovery", zone: 1, labelX: 604, labelY: 440, d: "M393 532L393 348L815 348L815 532Z" },
];

export function getRoom(id: string | undefined | null): Room | null {
  if (!id) return null;
  return ROOMS.find((room) => room.id === id) ?? null;
}

export function roomLabel(room: Room): string {
  return room.kind === "or" ? `OR ${room.number}` : `RR ${room.number}`;
}

export function isSelectableRoom(room: Room): boolean {
  return room.kind === "or";
}
