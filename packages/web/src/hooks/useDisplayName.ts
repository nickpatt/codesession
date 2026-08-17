import { useState } from "react";

const STORAGE_KEY = "codesession.displayName";

/**
 * Remembers the user's display name in localStorage so returning visitors (or
 * anyone who refreshes) don't have to re-enter it. Returns the current name
 * (or null if unset) and a setter that persists.
 */
export function useDisplayName(): [string | null, (name: string) => void] {
  const [name, setNameState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );

  function setName(next: string) {
    localStorage.setItem(STORAGE_KEY, next);
    setNameState(next);
  }

  return [name, setName];
}
