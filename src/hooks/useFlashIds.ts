import { useCallback, useEffect, useRef, useState } from "react";

/** Flash IDs added after the initial load. `resetIds` allows an ID to flash again. */
export function useFlashIds(
  ids: string[] | null,
  { durationMs = null as number | null, resetIds = [] as string[] } = {},
) {
  const seen = useRef<Set<string> | null>(null);
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(new Set());
  const key = ids?.join(",");
  const resetKey = resetIds.join(",");
  // Flash timers must survive subsequent updates.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (ids === null) return;
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    resetIds.forEach((id) => seen.current!.delete(id));
    const fresh = ids.filter((id) => !seen.current!.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => seen.current!.add(id));
    setFlashIds((prev) => new Set([...prev, ...fresh]));
    if (durationMs !== null) {
      timers.current.push(
        setTimeout(() => setFlashIds((prev) => new Set([...prev].filter((id) => !fresh.includes(id)))), durationMs),
      );
    }
    // Depend on array contents rather than array identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resetKey, durationMs]);

  const dismiss = useCallback(
    (id: string) => setFlashIds((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : prev)),
    [],
  );

  return { flashIds, dismiss };
}
