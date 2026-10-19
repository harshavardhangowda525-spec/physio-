import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg", "bcryptjs", "nodemailer"],
};

export default nextConfig;
