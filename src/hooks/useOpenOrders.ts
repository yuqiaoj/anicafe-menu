import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { orderFromDoc } from "../fromFirestore";
import { PersistedOrder } from "../types";
import { isSpecialtyOnly, notifySnapshotError } from "../utils";

// Specialty-only orders completed before `specialtyOnly` existed were never marked completed.
const isEffectivelyOpen = (order: PersistedOrder) =>
  !(order.specialtyOnly === undefined && isSpecialtyOnly(order.categories) && order.categories.Specialty.done);

// Sorting here avoids needing a composite index. Pending orders have no timestamp yet and sort last.
const placedAtMs = (order: PersistedOrder) => order.timestamp?.toMillis() ?? Number.MAX_SAFE_INTEGER;

export function useOpenOrders() {
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<PersistedOrder[] | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "orders"), where("completed", "==", false)),
        (snapshot) => {
          setOrders(
            snapshot.docs
              .map(orderFromDoc)
              .filter(isEffectivelyOpen)
              .sort((a, b) => placedAtMs(a) - placedAtMs(b)),
          );
          setError(null);
        },
        (error) => {
          setError(error.message);
          notifySnapshotError("orders")(error);
        },
      ),
    [],
  );

  return { orders, error };
}
