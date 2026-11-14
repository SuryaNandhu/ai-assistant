import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The old add page now lives at /saved/add. */
export default function InboxAddRedirect() {
  redirect("/saved/add");
}
