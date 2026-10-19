import { Atmosphere } from "@/components/Atmosphere";
import { ChatWidget } from "@/components/ChatWidget";

export const metadata = { title: "Chat — Physiotherapy Treatment at Home", robots: { index: false } };

/** Chat only, for the iframe that /widget.js opens on the clinic website. */
export default function EmbedPage() {
  return (
    <>
      <Atmosphere />
      <ChatWidget variant="embed" />
    </>
  );
}
