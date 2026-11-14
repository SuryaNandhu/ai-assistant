import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The old Inbox route now lives at /saved. */
export default function InboxRedirect() {
  redirect("/saved");
}
