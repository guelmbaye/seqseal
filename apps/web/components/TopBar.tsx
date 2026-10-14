"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoll } from "@/lib/client";
import { SOURCE_LABEL, type SystemStatus } from "@/lib/types";

const NAV = [
  { href: "/", label: "Winning Moment" },
  { href: "/monitor", label: "Monitor" },
  { href: "/executions", label: "Executions" },
  { href: "/protocol", label: "Protocol" },
  { href: "/receipts", label: "Receipts" },
  { href: "/system", label: "System" },
];

export function TopBar() {
  const path = usePathname();
  const { data } = usePoll<SystemStatus & { mode?: string }>("/api/status", 5000);
  const lastProfile = data?.last_observation?.source_profile;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="shell-top">
      <div className="shell-top-inner">
        <Link href="/" className="brand" aria-label="SEQSEAL home">
          <Image src="/brand/seqseal-logo.png" alt="SEQSEAL" width={124} height={26} priority />
        </Link>
        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="shell-source">
          <span className="source-chip" title={data ? `${data.backend}; protocol ${data.protocol.ref}` : "Connecting"}>
            <span className={`dot${data ? "" : " off"}`} />
            Source{" "}
            <strong>{lastProfile ? (SOURCE_LABEL[lastProfile] ?? lastProfile) : data ? "waiting for observations" : "connecting"}</strong>
          </span>
        </div>
      </div>
    </header>
  );
}
