const portalTabTitles: Record<string, string> = {
  datos: "Datos",
  asistencia: "Mis Asistencias",
  boletas: "Mis Boletas",
  equipos: "Mis Equipos",
  solicitudes: "Mis Solicitudes",
  notificaciones: "Notificaciones",
};

export function formatPageTitle(module: string): string {
  return `${module} • EnviaMas RRHH`;
}

export function resolvePageTitle(pathname: string, search: string): string {
  if (pathname === "/login") {
    return formatPageTitle("Inicio de sesión");
  }

  if (pathname.startsWith("/invitar/")) {
    return formatPageTitle("Invitación");
  }

  if (pathname === "/") {
    return formatPageTitle("Inicio");
  }

  if (pathname === "/colaboradores/nuevo") {
    return formatPageTitle("Nuevo colaborador");
  }

  if (pathname === "/colaboradores/renuncias") {
    return formatPageTitle("Renuncias");
  }

  if (/^\/colaboradores\/\d+\/edit$/.test(pathname)) {
    return formatPageTitle("Editar colaborador");
  }

  if (/^\/colaboradores\/\d+$/.test(pathname)) {
    return formatPageTitle("Perfil de colaborador");
  }

  if (pathname === "/colaboradores") {
    return formatPageTitle("Colaboradores");
  }

  if (pathname === "/asistencia") {
    return formatPageTitle("Asistencia");
  }

  if (pathname === "/boletas" || pathname === "/descuentos") {
    return formatPageTitle("Boletas y Nómina");
  }

  if (pathname === "/portal") {
    const tab = new URLSearchParams(search).get("tab") ?? "datos";
    return formatPageTitle(portalTabTitles[tab] ?? "Portal del Colaborador");
  }

  if (pathname === "/activos") {
    return formatPageTitle("Activos y Equipos");
  }

  if (pathname === "/reportes") {
    return formatPageTitle("Reportes");
  }

  if (pathname === "/perfiles") {
    return formatPageTitle("Perfiles y Permisos");
  }

  if (pathname === "/configuracion") {
    return formatPageTitle("Configuración");
  }

  return formatPageTitle("Página no encontrada");
}
