"use client";
import { formatNs, formatUsd, type Invoice } from "@tradewind/core";
import { useView } from "./write-controls";

export function InvoiceNftPreview({ invoice }: { invoice: Invoice }) {
  const token = useView<{ metadata?: { media?: string } } | null>("nft_token", { token_id: invoice.id }, !!invoice.accepted_at);
  const media = token.value?.metadata?.media;
  if (media && /^data:image\/(?:svg\+xml|png|jpeg|webp)(?:;base64)?,/i.test(media)) return <img className="tw-nft-preview" src={media} alt={`Tradewind invoice NFT ${invoice.id}`} width="480" height="300" />;
  return <svg className="tw-nft-preview" viewBox="0 0 480 300" role="img" aria-label={`Tradewind invoice NFT preview ${invoice.id}`}>
    <rect width="480" height="300" rx="20" fill="#0b1f33" />
    <rect x="24" y="20" width="52" height="52" rx="8" fill="#f6f4ef" />
    <image href="/brand/tradewind-mark.svg" x="24" y="20" width="52" height="52" />
    <g fill="#f6f4ef"><text x="88" y="53" fontSize="24">Tradewind</text><text x="28" y="108" fontSize="22">{invoice.id.slice(0, 32)}</text><text x="28" y="157" fontSize="36">{formatUsd(invoice.face)} USDC</text><text x="28" y="191" fontSize="18">Net {invoice.tenor_days}</text><text x="28" y="222" fontSize="16">Due: {invoice.due_at ? formatNs(invoice.due_at) : "Set on acceptance"}</text></g>
    <rect x="28" y="242" width="250" height="34" rx="17" fill={invoice.status === "Defaulted" ? "#e5484d" : invoice.status === "Repaid" ? "#00c08b" : "#f5a524"} />
    <text x="44" y="264" fontSize="16" fill="#0b1f33">{invoice.status}</text>
  </svg>;
}
