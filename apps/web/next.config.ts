import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", transpilePackages: ["@tradewind/core"] };
export default config;
