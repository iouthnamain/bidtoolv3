import { useCallback, useMemo, useState } from "react";

export function useRowSelection<K extends string | number = number>(allIds: K[]) {
  const [selected, setSelected] = useState<Set<K>>(new Set());

  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;
  const indeterminate = someSelected && !allSelected;

  const toggle = useCallback((id: K) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (allIds.every((id) => prev.has(id))) {
        return new Set();
      }
      return new Set(allIds);
    });
  }, [allIds]);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return {
    selected,
    selectedIds,
    selectedCount: selected.size,
    allSelected,
    someSelected,
    indeterminate,
    toggle,
    toggleAll,
    clear,
  };
}
