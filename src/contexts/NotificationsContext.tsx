import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { onToastAdded } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchPortalNotificationsPage,
  patchPortalNotificationRead,
  postPortalNotificationsReadAll,
  type PortalEmployeeNotification,
} from "@/api/portal";
import {
  fetchUserNotificationsPage,
  patchUserNotificationRead,
  postUserNotificationsReadAll,
  type UserNotificationRow,
} from "@/api/userNotifications";
import { ApiHttpError } from "@/api/client";
import { formatAppDateTime } from "@/lib/formatAppDate";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "enviarrhh.headerToastNotifications.v1";

/** Maps sub-routes to their parent module route */
function getModuleRoute(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length > 1) {
    return "/" + segments[0];
  }
  return path;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  description: string;
  time: string;
  read: boolean;
  link: string;
  source: "portal" | "toast" | "approver";
  /** ISO timestamp for retention (portal: from API; toast: stored locally) */
  createdAt?: string | null;
}

function isWithinRetention(createdAt: string | null | undefined): boolean {
  if (createdAt == null || createdAt === "") return true;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= RETENTION_MS;
}

function mapPortalKindToType(kind: string): "warning" | "info" | "success" {
  const k = kind.toLowerCase();
  if (k.includes("vacation") || k.includes("vacac") || k.includes("aprob") || k.includes("approved")) {
    return "success";
  }
  if (k.includes("contract") || k.includes("contrato") || k.includes("venc") || k.includes("expir")) {
    return "warning";
  }
  return "info";
}

function formatNotificationTime(iso: string | null): string {
  return formatAppDateTime(iso);
}

function linkForPortalNotification(kind: string, meta: Record<string, unknown> | null | undefined): string {
  const k = (kind ?? "").toLowerCase();
  const q = new URLSearchParams();
  if (k === "payslip.available" || k.startsWith("payslip.")) {
    q.set("tab", "boletas");
  } else if (k.startsWith("termination.")) {
    q.set("tab", "datos");
  } else if (k.startsWith("vacation.") || k.startsWith("resignation.")) {
    q.set("tab", "solicitudes");
  } else {
    q.set("tab", "notificaciones");
  }
  const s = q.toString();
  return s ? `/portal?${s}` : "/portal";
}

function mapPortalRow(n: PortalEmployeeNotification): Notification {
  const createdAt = n.created_at ?? null;
  return {
    id: n.id,
    type: mapPortalKindToType(n.kind ?? ""),
    title: n.title,
    description: (n.body ?? "").trim() || "—",
    time: formatNotificationTime(createdAt),
    read: n.read_at != null,
    link: linkForPortalNotification(n.kind ?? "", n.meta ?? null),
    source: "portal",
    createdAt,
  };
}

function mapUserNotificationKindToType(kind: string): "warning" | "info" | "success" {
  const k = kind.toLowerCase();
  if (k.includes("pending") || k.includes("pendient") || k.includes("nueva")) {
    return "info";
  }
  if (k.includes("vacation") || k.includes("vacac")) {
    return "info";
  }
  return "info";
}

function parseMetaEmployeeId(meta: Record<string, unknown> | null | undefined): number | null {
  if (meta == null || typeof meta !== "object") return null;
  const raw = meta.employee_id;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function linkForApproverUserNotification(
  kind: string | null | undefined,
  meta?: Record<string, unknown> | null,
): string {
  const k = (kind ?? "").toLowerCase();
  const employeeId = parseMetaEmployeeId(meta ?? null);

  if (k === "resignation.pending" || k.startsWith("resignation.")) {
    return employeeId != null ? `/colaboradores/${employeeId}` : "/colaboradores/renuncias";
  }
  if (k === "vacation.pending" || k.startsWith("vacation.")) {
    if (employeeId != null) {
      const q = new URLSearchParams();
      q.set("tab", "vacaciones");
      q.set("employee_id", String(employeeId));
      return `/asistencia?${q.toString()}`;
    }
    return "/asistencia?tab=vacaciones";
  }
  if (k === "attendance.justification" || k.startsWith("attendance.justification")) {
    const q = new URLSearchParams();
    q.set("tab", "calendario");
    if (employeeId != null) {
      q.set("employee_id", String(employeeId));
    }
    return `/asistencia?${q.toString()}`;
  }
  return "/asistencia?tab=vacaciones";
}

function mapApproverRow(n: UserNotificationRow): Notification {
  const createdAt = n.created_at ?? null;
  return {
    id: n.id,
    type: mapUserNotificationKindToType(n.kind ?? ""),
    title: n.title,
    description: (n.body ?? "").trim() || "—",
    time: formatNotificationTime(createdAt),
    read: n.read_at != null,
    link: linkForApproverUserNotification(n.kind, n.meta ?? null),
    source: "approver",
    createdAt,
  };
}

function storageKeyForUser(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function loadToastFromStorage(userId: string): Notification[] {
  try {
    const raw = localStorage.getItem(storageKeyForUser(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{
      id: number;
      type: string;
      title: string;
      description: string;
      read: boolean;
      link: string;
      createdAt: string;
    }>;
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - RETENTION_MS;
    const kept = parsed.filter((p) => {
      const t = new Date(p.createdAt).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
    if (kept.length !== parsed.length) {
      localStorage.setItem(storageKeyForUser(userId), JSON.stringify(kept));
    }
    return kept.map((p) => ({
      id: p.id,
      type: p.type,
      title: p.title,
      description: p.description,
      read: p.read,
      link: p.link,
      time: formatNotificationTime(p.createdAt),
      source: "toast" as const,
      createdAt: p.createdAt,
    }));
  } catch {
    return [];
  }
}

function saveToastToStorage(userId: string, items: Notification[]) {
  try {
    const toastOnly = items.filter((n) => n.source === "toast");
    const payload = toastOnly.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      description: n.description,
      read: n.read,
      link: n.link,
      createdAt: n.createdAt ?? new Date().toISOString(),
    }));
    localStorage.setItem(storageKeyForUser(userId), JSON.stringify(payload));
  } catch {
    /* quota or private mode */
  }
}

interface NotificationsContextType {
  notifications: Notification[];
  addNotification: (title: string, description?: string, type?: string, link?: string) => void;
  markNotificationRead: (target: Pick<Notification, "id" | "source">) => Promise<void>;
  dismissNotification: (target: Pick<Notification, "id" | "source">) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  clearAllNotifications: () => void;
  unreadCount: number;
}

const NotificationsContext = createContext<NotificationsContextType | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { hasPermission, hasAnyPermission, user } = useAuth();
  const canPortal = hasPermission("portal.view");
  const canApproverInbox = hasAnyPermission([
    "attendance.approve",
    "employees.edit",
    "attendance.manage",
  ]);

  const [toastNotifications, setToastNotifications] = useState<Notification[]>([]);
  const [portalNotifications, setPortalNotifications] = useState<Notification[]>([]);
  const [approverNotifications, setApproverNotifications] = useState<Notification[]>([]);

  const userId = user?.id != null ? String(user.id) : null;

  useEffect(() => {
    if (!userId) {
      setToastNotifications([]);
      return;
    }
    setToastNotifications(loadToastFromStorage(userId));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    saveToastToStorage(userId, toastNotifications);
  }, [userId, toastNotifications]);

  const notifications = useMemo(() => {
    const merged = [...toastNotifications, ...portalNotifications, ...approverNotifications].filter((n) =>
      isWithinRetention(n.createdAt),
    );
    merged.sort((a, b) => {
      const ta = new Date(a.createdAt ?? 0).getTime();
      const tb = new Date(b.createdAt ?? 0).getTime();
      return tb - ta;
    });
    return merged;
  }, [toastNotifications, portalNotifications, approverNotifications]);

  const notificationsRef = useRef<Notification[]>([]);
  notificationsRef.current = notifications;

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!canPortal) {
      setPortalNotifications([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const r = await fetchPortalNotificationsPage({ page: 1, per_page: 20 });
        if (cancelled) return;
        const rows = r.data.map(mapPortalRow).filter((n) => isWithinRetention(n.createdAt));
        setPortalNotifications(rows);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiHttpError && e.status === 404) {
          setPortalNotifications([]);
        } else {
          setPortalNotifications([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canPortal, user?.id]);

  useEffect(() => {
    if (!canApproverInbox) {
      setApproverNotifications([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const r = await fetchUserNotificationsPage({ page: 1, per_page: 20 });
        if (cancelled) return;
        const rows = r.data.map(mapApproverRow).filter((n) => isWithinRetention(n.createdAt));
        setApproverNotifications(rows);
      } catch {
        if (cancelled) return;
        setApproverNotifications([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canApproverInbox, user?.id]);

  const addNotification = useCallback((title: string, description?: string, type: string = "info", link?: string) => {
    const createdAt = new Date().toISOString();
    const newNotif: Notification = {
      id: Date.now(),
      title,
      description: description || "",
      type,
      time: formatNotificationTime(createdAt),
      read: false,
      link: link || getModuleRoute(window.location.pathname),
      source: "toast",
      createdAt,
    };
    setToastNotifications((prev) => [newNotif, ...prev]);
  }, []);

  const markNotificationRead = useCallback(async (target: Pick<Notification, "id" | "source">) => {
    const n = notificationsRef.current.find((x) => x.id === target.id && x.source === target.source);
    if (!n || n.read) return;

    const id = target.id;

    if (n.source === "portal") {
      try {
        const r = await patchPortalNotificationRead(id);
        const mapped = mapPortalRow(r.data);
        setPortalNotifications((prev) => prev.map((x) => (x.id === id ? mapped : x)));
      } catch {
        setPortalNotifications((prev) => prev.map((x) => (x.id === id ? { ...x, read: true } : x)));
      }
    } else if (n.source === "approver") {
      try {
        const r = await patchUserNotificationRead(id);
        const mapped = mapApproverRow(r.data);
        setApproverNotifications((prev) => prev.map((x) => (x.id === id ? mapped : x)));
      } catch {
        setApproverNotifications((prev) => prev.map((x) => (x.id === id ? { ...x, read: true } : x)));
      }
    } else {
      setToastNotifications((prev) => prev.map((x) => (x.id === id ? { ...x, read: true } : x)));
    }
  }, []);

  const dismissNotification = useCallback(async (target: Pick<Notification, "id" | "source">) => {
    const n = notificationsRef.current.find((x) => x.id === target.id && x.source === target.source);
    const id = target.id;
    if (n?.source === "portal" && !n.read) {
      try {
        await patchPortalNotificationRead(id);
      } catch {
        /* ignore */
      }
    }
    if (n?.source === "approver" && !n.read) {
      try {
        await patchUserNotificationRead(id);
      } catch {
        /* ignore */
      }
    }
    if (n?.source === "toast") {
      setToastNotifications((prev) => prev.filter((x) => x.id !== id));
    } else if (n?.source === "approver") {
      setApproverNotifications((prev) => prev.filter((x) => x.id !== id));
    } else {
      setPortalNotifications((prev) => prev.filter((x) => x.id !== id));
    }
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    if (canPortal) {
      try {
        await postPortalNotificationsReadAll();
      } catch (e) {
        if (!(e instanceof ApiHttpError && e.status === 404)) {
          throw e;
        }
      }
      setPortalNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
    }
    if (canApproverInbox) {
      try {
        await postUserNotificationsReadAll();
      } catch {
        /* ignore */
      }
      setApproverNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
    }
    setToastNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
  }, [canPortal, canApproverInbox]);

  const clearAllNotifications = useCallback(() => {
    setToastNotifications([]);
    setPortalNotifications([]);
    setApproverNotifications([]);
  }, []);

  useEffect(() => {
    const unsubscribe = onToastAdded((toastData) => {
      if (toastData.variant === "destructive") return;
      const title = typeof toastData.title === "string" ? toastData.title : "";
      const description = typeof toastData.description === "string" ? toastData.description : "";
      if (title) {
        addNotification(title, description, "info");
      }
    });
    return unsubscribe;
  }, [addNotification]);

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        addNotification,
        markNotificationRead,
        dismissNotification,
        markAllNotificationsRead,
        clearAllNotifications,
        unreadCount,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
