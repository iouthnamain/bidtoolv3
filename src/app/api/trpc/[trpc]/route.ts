import { type NextRequest } from "next/server";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { createLogger } from "~/server/lib/logger";
import { fetchRequestHandlerWithLogging } from "~/server/lib/trpc-request-log";

const log = createLogger("trpc");

export const maxDuration = 300;

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
  return createTRPCContext({
    headers: req.headers,
  });
};

const handler = (req: NextRequest) =>
  fetchRequestHandlerWithLogging({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError: ({ path, error }) => {
      log.error("procedure_failed", {
        path: path ?? "<no-path>",
        code: error.code,
        error,
      });
    },
  });

export { handler as GET, handler as POST };
