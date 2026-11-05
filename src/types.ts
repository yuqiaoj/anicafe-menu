import { Timestamp } from "firebase/firestore";

export type StockLevel = "high" | "low" | "none";

export interface MenuItem {
  itemName: string;
  priceCents: number;
  stock: StockLevel;
  flags?: string[];
}

export interface MenuCategory {
  categoryName: string;
  /** Display order. Missing on categories saved before ordering was added. */
  position?: number;
  items: MenuItem[];
}

export type OrderItems = { [itemName: string]: { quantity: number } };

export interface OrderCategory {
  done: boolean;
  items: OrderItems;
}

export interface Order {
  id?: string;
  timestamp?: Timestamp;
  /** Missing on orders saved before this field was added. */
  specialtyOnly?: boolean;
  zone?: string;
  number: number;
  /** Total after the discount has been subtracted */
  totalCents: number;
  discountCents: number;
  notes: string;
  completed: boolean;
  categories: { [categoryName: string]: OrderCategory };
}

export interface PersistedOrder extends Order {
  id: string;
}
