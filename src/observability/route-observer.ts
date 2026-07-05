import type { RouteObserver } from "../types.js";

export function createConsoleRouteObserver(): RouteObserver {
  return (event) => {
    console.info(
      JSON.stringify({
        event: "line_function_route",
        timestamp: new Date().toISOString(),
        ...event
      })
    );
  };
}
