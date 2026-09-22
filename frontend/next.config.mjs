/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 画面は Vercel、API と WebSocket はホームサーバー。
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? 'https://cost.blueberry-team.com',
  },
};
export default nextConfig;
