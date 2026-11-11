#!/usr/bin/env python3
"""Parse near-cli-rs text output offline; never contact RPC or write files."""
import json
import re
import sys

text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", sys.stdin.read())
mode = sys.argv[1]
if mode == "hash":
    hashes = re.findall(r"Transaction (?:ID|Id|id|hash):\s*[`\"']?([1-9A-HJ-NP-Za-km-z]{32,44})", text)
    if not hashes:
        sys.exit("No transaction ID found. Inspect the CLI output; do not blindly rerun.")
    for value in dict.fromkeys(hashes):
        print(f"Transaction hash: {value}")
elif mode in ("event", "invoice"):
    wanted = sys.argv[2] if mode == "event" else "invoice_created"
    events = []
    for match in re.finditer(r"EVENT_JSON:", text):
        try:
            event, _ = json.JSONDecoder().raw_decode(text[match.end():].lstrip())
        except json.JSONDecodeError:
            continue
        if event.get("standard") == "tradewind" and event.get("event") == wanted:
            events.append(event)
    if not events:
        sys.exit(f"Missing {wanted} receipt event. Stop and inspect receipts before continuing.")
    if mode == "invoice":
        data = events[-1]["data"]
        if isinstance(data, list):
            data = data[0]
        invoice = data["invoice"]
        print(json.dumps({"id": invoice["id"], "terms_hash": invoice["terms_hash"]}))
    else:
        print(f"Confirmed receipt event: {wanted}")
else:
    sys.exit("Expected hash, event, or invoice mode")
