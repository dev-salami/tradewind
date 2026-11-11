"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/components/wallet-provider";

export function useOwnerAccess() {
  const { accountId, revision } = useWallet();
  const [verified, setVerified] = useState<string | null>(null);
  const refresh = useCallback(() => fetch("/api/ops", { cache: "no-store" })
    .then(async response => {
      const data = await response.json();
      setVerified(response.ok && data.isOwner ? data.accountId : null);
    }).catch(() => { setVerified(null); }), []);
  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("ops-session", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("ops-session", refresh); };
  }, [refresh, accountId, revision]);
  return { allowed: !!accountId && verified === accountId, refresh };
}
