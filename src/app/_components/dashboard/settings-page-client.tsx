"use client";

import { AboutVersionSection } from "~/app/_components/dashboard/about-version-section";
import { DesktopSettingsSection } from "~/app/_components/dashboard/desktop-settings-page-client";
import { PageSectionNav } from "~/app/_components/dashboard/page-section-nav";
import { SettingsStatusStrip } from "~/app/_components/dashboard/settings-status-strip";
import { settingsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

export function SettingsPageClient() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageSectionNav title="Cài đặt" items={settingsSectionNavItems} />

      <SettingsStatusStrip />

      <DesktopSettingsSection />

      <AboutVersionSection />
    </div>
  );
}
