import { ItemIdentifiers } from "./ItemIdentifiers";
import { ObjectIdentifiers } from "./ObjectIdentifiers";
import { NpcIdentifiers } from "./NpcIdentifiers";

type NumericKey<T> = {
  [K in keyof T]-?: T[K] extends number ? K : never;
}[keyof T];

type NumericStatics<T> = Readonly<Pick<T, NumericKey<T>>>;

function toNumericEnum<T extends object>(identifiers: T): NumericStatics<T> {
  const entries = Object.entries(
    identifiers as { [key: string]: unknown }
  ).filter(
    ([, value]) => typeof value === "number"
  ) as Array<[string, number]>;
  return Object.freeze(Object.fromEntries(entries)) as NumericStatics<T>;
}

export const ItemIds = toNumericEnum(ItemIdentifiers);
export const ObjectIds = toNumericEnum(ObjectIdentifiers);
export const NpcIds = toNumericEnum(NpcIdentifiers);

export type ItemId = (typeof ItemIds)[keyof typeof ItemIds];
export type ObjectId = (typeof ObjectIds)[keyof typeof ObjectIds];
export type NpcId = (typeof NpcIds)[keyof typeof NpcIds];
