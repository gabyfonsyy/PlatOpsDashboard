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
  // The page is Mission Control in Gaby's View and My Work everywhere else, so the URL follows the
  // plain name — the one that matches lib/work.ts, /api/work/* and the work_* tables. /mission-control
  // existed briefly as the route and is the sort of thing that gets pinned as a tab, so it redirects.
  async redirects() {
    return [{ source: "/mission-control", destination: "/my-work", permanent: true }];
  },
};

export default nextConfig;
