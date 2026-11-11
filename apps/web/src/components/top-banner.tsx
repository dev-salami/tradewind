import type { NearNetwork } from "@tradewind/core";
export function TopBanner({ network, secondsPerDay, fixtures = false }: { network: NearNetwork; secondsPerDay: number | null; fixtures?: boolean }) {
  return <aside className="tw-banner" aria-label="Network and demo clock">
    <span>{network === "mainnet" ? "Mainnet showcase · real funds, tiny amounts" : "Testnet sandbox"}</span>
    <span>{secondsPerDay === null ? "Demo clock unavailable · config could not be loaded" : `Demo clock: 1 contract day = ${secondsPerDay} s`}</span>
    {fixtures && <strong>Sample data · no real transactions</strong>}
  </aside>;
}
