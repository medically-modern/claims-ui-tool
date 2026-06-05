/**
 * Hook that returns the correct back-navigation target.
 * When navigating from System Management, the `from` query param is set to
 * "system-mgmt" so the back button returns there instead of the main dashboard.
 */
import { useSearchParams, useNavigate } from "react-router-dom";
import { useCallback } from "react";

export function useBackNavigation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const from = searchParams.get("from");

  const backTarget = from === "system-mgmt" ? "/system-mgmt" : "/?tab=dashboard";

  const goBack = useCallback(() => {
    navigate(backTarget);
  }, [navigate, backTarget]);

  return { backTarget, goBack };
}
