import { redirect } from "next/navigation";

/** Compatibility entry point for older bookmarks and shared links. */
export default function MaterialProfilePage() {
  redirect("/material-profiles");
}
