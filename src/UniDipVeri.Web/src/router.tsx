import { createRouter } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";

export function getRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: {
      queryClient,
      auth: undefined!, // Injected reactively via RouterProvider context prop
    },
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
