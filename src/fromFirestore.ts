import { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { MenuCategory, PersistedOrder } from "./types";

// Read legacy dollar prices as well as prices in cents.

const legacyCents = (dollars: unknown) => (typeof dollars === "number" ? Math.round(dollars * 100) : 0);

const toCentsMenuItems = (items: DocumentData[] = []) =>
  items.map(({ price, ...item }) => ({ ...item, priceCents: item.priceCents ?? legacyCents(price) }));

export const menuCategoryFromDoc = (snapshot: QueryDocumentSnapshot<DocumentData>): MenuCategory => {
  const data = snapshot.data();
  return {
    categoryName: data.categoryName,
    ...(typeof data.position === "number" && { position: data.position }),
    items: toCentsMenuItems(data.items),
  } as MenuCategory;
};

export const orderFromDoc = (snapshot: QueryDocumentSnapshot<DocumentData>): PersistedOrder => {
  const { price, discount, ...data } = snapshot.data();
  return {
    ...data,
    id: snapshot.id,
    totalCents: data.totalCents ?? legacyCents(price),
    discountCents: data.discountCents ?? legacyCents(discount),
  } as PersistedOrder;
};
