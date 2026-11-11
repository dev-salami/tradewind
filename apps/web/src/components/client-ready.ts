"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
/** Mount storage-backed controls only in the browser, without hydration mismatches. */
export function useClientReady() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
