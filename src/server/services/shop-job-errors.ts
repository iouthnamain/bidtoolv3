export class ShopJobServiceError extends Error {
  constructor(
    public readonly code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ShopJobServiceError";
  }
}
