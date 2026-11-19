import type { QueryClient, QueryKey } from "@tanstack/react-query";

export async function refreshQuery(
  client: QueryClient,
  queryKey: QueryKey,
  includes: (input: Readonly<Record<string, unknown>>) => boolean = () => true,
) {
  const filters = {
    queryKey,
    predicate: ({ queryKey: [, options] }: { queryKey: QueryKey }) => {
      const input =
        options && typeof options === "object" && "input" in options
          ? options.input
          : undefined;
      return includes(
        input && typeof input === "object"
          ? (input as Record<string, unknown>)
          : {},
      );
    },
  };

  // An initial fetch can otherwise overwrite the invalidation with pre-save data.
  await client.cancelQueries(filters);
  await client.invalidateQueries(filters);
}
