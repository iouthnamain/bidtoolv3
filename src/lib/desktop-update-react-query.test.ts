import { describe, expect, it } from "vitest";

import { desktopUpdateStateQueryOptions } from "./desktop-update-react-query";

describe("desktop update react query", () => {
  it("keeps desktop update state fresh via mount refetch and push updates", () => {
    const options = desktopUpdateStateQueryOptions();

    expect(options.staleTime).toBe(Infinity);
    expect(options.refetchOnMount).toBe("always");
    expect(options.queryKey).toEqual(["desktop-update", "state"]);
  });
});
