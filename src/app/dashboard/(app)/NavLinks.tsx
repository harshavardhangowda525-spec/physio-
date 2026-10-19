"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBell, IconList, IconSettings } from "@/components/Icons";

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const links = [
    { href: "/dashboard", label: "Enquiries", icon: <IconList />, match: (p: string) => p === "/dashboard" || p.startsWith("/dashboard/enquiries") },
    { href: "/dashboard/notifications", label: "Notifications", icon: <IconBell />, match: (p: string) => p.startsWith("/dashboard/notifications") },
    ...(isAdmin ? [{ href: "/dashboard/settings", label: "Setup & status", icon: <IconSettings />, match: (p: string) => p.startsWith("/dashboard/settings") }] : []),
  ];
  return (
    <nav aria-label="Dashboard">
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>
          {l.icon}
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
