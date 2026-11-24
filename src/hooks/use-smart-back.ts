import { useLocation, useNavigate } from "react-router-dom";

/**
 * Back navigation that returns to the exact previous screen (history
 * POP) instead of a hard-coded parent route. Falls back to `fallback`
 * only when this tab has no in-app history to go back to (e.g. the
 * page was opened directly from a shared link), where location.key is
 * the router's initial "default" entry.
 */
export function useSmartBack() {
  const navigate = useNavigate();
  const location = useLocation();
  return (fallback = "/") => {
    if (location.key !== "default") {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  };
}
