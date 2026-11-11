import { automationStore } from "@tradewind/core/automation-store";
import { store } from "../db";
export const telegramStore = () => automationStore(store().db);
