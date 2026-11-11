import type { NextConfig } from "next";
// pdfjs-dist loads its worker module at runtime; bundling it breaks server-side PDF parsing.
const config: NextConfig = { output: "standalone", transpilePackages: ["@tradewind/core"], serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"] };
export default config;
