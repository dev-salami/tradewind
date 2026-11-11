import "server-only";
import { getInvoice } from "@tradewind/core";
import { env } from "../env";
export function onChainInvoice(id: string) { const e = env(); return getInvoice(e.NEAR_RPC_URL, e.CORE_CONTRACT_ID, id); }
