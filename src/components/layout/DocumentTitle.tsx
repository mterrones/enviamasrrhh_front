import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { resolvePageTitle } from "@/lib/pageTitles";

export function DocumentTitle() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    document.title = resolvePageTitle(pathname, search);
  }, [pathname, search]);

  return null;
}
