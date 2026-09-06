import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

/**
 * Extracts a user-friendly error message from API errors (Axios, ProblemDetails, network).
 * Prevents raw HTTP status messages (e.g. "Request failed with status code 401") from displaying to users.
 */
export function getApiErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (axios.isAxiosError(err)) {
    const data: unknown = err.response?.data;

    // Direct string message
    if (typeof data === "string" && data.trim()) {
      return data;
    }

    // JSON object responses (standard ASP.NET or custom API payloads)
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;

      if (typeof record["message"] === "string" && record["message"].trim()) {
        return record["message"];
      }
      if (typeof record["error"] === "string" && record["error"].trim()) {
        return record["error"];
      }
      if (typeof record["detail"] === "string" && record["detail"].trim()) {
        return record["detail"];
      }
      if (typeof record["title"] === "string" && record["title"].trim()) {
        return record["title"];
      }

      // ASP.NET Core model validation errors: { errors: { field: ["message"] } }
      if (record["errors"] && typeof record["errors"] === "object") {
        const errorEntries = Object.values(
          record["errors"] as Record<string, unknown>,
        );
        const flattened = errorEntries
          .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
          .filter(
            (msg): msg is string => typeof msg === "string" && Boolean(msg),
          );

        if (flattened.length > 0) {
          return flattened.join(". ");
        }
      }
    }

    // HTTP status code specific fallbacks
    switch (err.response?.status) {
      // 4xx errors
      case 400:
        return "The request could not be processed. Please check your information.";
      case 401:
        return "Authentication failed or your session has expired.";
      case 403:
        return "You do not have permission to perform this action.";
      case 404:
        return "The requested resource could not be found.";
      case 405:
        return "The requested action is not supported.";
      case 408:
        return "The request timed out. Please try again.";
      case 409:
        return "The request conflicted with existing data. Please try again.";
      case 422:
        return "The provided data is invalid. Please check your input.";
      case 429:
        return "Too many requests. Please wait a moment and try again.";

      // 5xx errors
      case 500:
        return "An internal server error occurred. Please try again shortly.";
      case 502:
        return "Bad gateway. The server received an invalid response. Please try again.";
      case 503:
        return "The service is temporarily unavailable. Please try again shortly.";
      case 504:
        return "The gateway timed out waiting for the server. Please try again shortly.";

      default:
        if (!err.response) {
          return "Unable to connect to the server. Please check your connection and try again.";
        }
    }
  }

  if (
    err instanceof Error &&
    !err.message.toLowerCase().includes("status code")
  ) {
    return err.message;
  }

  return fallback;
}
