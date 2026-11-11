//! View-only SVGs: no per-token media is persisted in contract storage.
use crate::{invoice::Invoice, InvoiceStatus};
use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};

const MARK: &str = "<path d='M88 92C260 92 380 160 456 256C372 204 262 180 88 180A44 44 0 0 1 88 92Z' fill='#00C08B'/><path d='M88 420C260 420 380 352 456 256C372 308 262 332 88 332A44 44 0 0 0 88 420Z' fill='#F5A524'/><path d='M178 228H346A28 28 0 0 1 346 284H178A28 28 0 0 1 178 228Z' fill='#0B1F33'/>";

fn data_uri(svg: &str) -> String {
    format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg))
}

pub(crate) fn icon() -> String {
    data_uri(&format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>{MARK}</svg>"))
}

pub(crate) fn dollars(amount: u128) -> String {
    format!("${}.{:02}", amount / 1_000_000, amount % 1_000_000 / 10_000)
}

fn xml_label(text: &str) -> String {
    // Truncate before escaping, at Unicode scalar boundaries. Strip XML 1.0
    // forbidden control characters too; escaping alone does not make those safe.
    text.chars().filter(|c| matches!(*c, '\t' | '\n' | '\r') || *c >= ' ')
        .filter(|c| !matches!(*c, '\u{fffe}' | '\u{ffff}'))
        .take(32).collect::<String>()
        .replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
        .replace('"', "&quot;").replace('\'', "&apos;")
}

pub(crate) fn invoice_media(i: &Invoice) -> String {
    let (status, colour) = match i.status {
        InvoiceStatus::Defaulted => ("Defaulted", "#E5484D"),
        InvoiceStatus::Repaid => ("Paid", "#00C08B"),
        InvoiceStatus::Funded | InvoiceStatus::AdvancePending => ("Funded", "#00C08B"),
        InvoiceStatus::PartiallyPaid if i.advance.is_some() => ("Funded", "#00C08B"),
        _ => ("Awaiting payment", "#F5A524"),
    };
    data_uri(&format!(
        "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='300' viewBox='0 0 480 300'><rect width='480' height='300' rx='20' fill='#0B1F33'/><svg x='24' y='20' width='52' height='52' viewBox='0 0 512 512'><rect width='512' height='512' rx='80' fill='#F6F4EF'/>{MARK}</svg><g font-family='sans-serif' fill='#F6F4EF'><text x='88' y='53' font-size='24'>Tradewind</text><text x='28' y='108' font-size='22'>{}</text><text x='28' y='157' font-size='36'>{} USDC</text><text x='28' y='191' font-size='18'>Net {}</text><text x='28' y='222' font-size='16'>{}</text></g><rect x='28' y='242' width='200' height='34' rx='17' fill='{colour}'/><text x='44' y='264' font-family='sans-serif' font-size='16' fill='#0B1F33'>{status}</text></svg>",
        xml_label(&i.id), dollars(i.face.0), i.tenor_days, xml_label(&i.buyer_label)
    ))
}
