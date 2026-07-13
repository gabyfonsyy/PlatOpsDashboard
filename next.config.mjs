/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["lh3.googleusercontent.com"],
  },
  // Next 14.2 caches dynamic page segments in the client Router Cache for 30s by default, so a
  // searchParams-only navigation (e.g. changing the Performance filter to Year/Quarter/Month/Week
  // within 30s) re-renders with STALE data instead of refetching. Setting dynamic to 0 — the
  // Next 15 default — makes every navigation refetch the dynamic segment so filters apply
  // immediately. static keeps its 5-min default for prefetched/static routes.
  experimental: {
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
