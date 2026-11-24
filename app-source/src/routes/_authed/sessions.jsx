import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Parent layout for the sessions index and session-detail routes.
 * The Outlet is required so /sessions/:sessionId can render its child page
 * instead of leaving the user on the sessions list.
 */
export const Route = createFileRoute("/_authed/sessions")({
  component: SessionsLayout,
});

function SessionsLayout() {
  return <Outlet />;
}
