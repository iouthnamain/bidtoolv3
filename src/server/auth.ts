import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";

import { db } from "~/server/db";
import {
  account,
  session,
  user,
  verification,
} from "~/server/db/schema";

type DeploymentSurface = "web" | "onprem" | "desktop-bundled";

// Mirror version-info.ts resolveSurface(): explicit env wins, then Vercel → web,
// otherwise default to on-prem. resolveSurface() there is not exported, so the
// logic is duplicated rather than imported.
function resolveSurface(): DeploymentSurface {
  const configured = process.env.BIDTOOL_DEPLOYMENT_SURFACE?.trim();
  if (
    configured === "web" ||
    configured === "onprem" ||
    configured === "desktop-bundled"
  ) {
    return configured;
  }

  if (process.env.VERCEL === "1") {
    return "web";
  }

  return "onprem";
}

const surface = resolveSurface();

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user,
      session,
      account,
      verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      // Custom column on `user` (Phase 1 schema). Declared here so Better Auth
      // selects it and includes it in the session payload; without this the
      // field is silently dropped from getSession() results.
      tenantId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  plugins: [
    admin({
      defaultRole: "customer",
      adminRoles: ["admin"],
    }),
  ],
  advanced: {
    // Relax secure cookies only for the local desktop bundle (http://localhost).
    useSecureCookies: surface !== "desktop-bundled",
  },
});
