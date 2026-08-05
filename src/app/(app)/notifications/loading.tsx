import { SkeletonPage } from "@/components/ui";

/** Route-level loading ghost for /notifications: header + inbox rows. */
export default function NotificationsLoading() {
  return <SkeletonPage rows={6} />;
}
