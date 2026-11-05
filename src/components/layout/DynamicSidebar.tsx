"use client";

import dynamic from "next/dynamic";

export const DynamicSidebar = dynamic(
  () => import("./SidebarWrapper").then((mod) => mod.SidebarWrapper),
  { ssr: false }
);

