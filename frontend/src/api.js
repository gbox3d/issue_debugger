let _config = null;

async function loadConfig() {
  if (_config) return _config;
  const base = import.meta.env.BASE_URL || "/";
  const resp = await fetch(`${base}config.json`);
  _config = resp.ok ? await resp.json() : {};
  return _config;
}

async function getApiBase() {
  const cfg = await loadConfig();
  const host = cfg.apiHost || "";
  const port = cfg.apiPort;

  // apiHost가 ""이면 현재 브라우저 호스트 사용
  if (!host) {
    return port
      ? `${window.location.protocol}//${window.location.hostname}:${port}`
      : "";
  }
  return port ? `${host}:${port}` : host;
}

export async function verifyText(request) {
  const apiBase = await getApiBase();
  const resp = await fetch(`${apiBase}/api/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || "서버 오류");
  }
  return resp.json();
}

export async function fetchReport(id) {
  const apiBase = await getApiBase();
  const resp = await fetch(`${apiBase}/api/reports/${encodeURIComponent(id)}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || "검증 기록을 불러오지 못했습니다.");
  }
  return resp.json();
}

export async function fetchVersion() {
  const apiBase = await getApiBase();
  const resp = await fetch(`${apiBase}/version`);
  if (!resp.ok) throw new Error("서버 연결 실패");
  return resp.json();
}

export async function verifyPersonnel(request) {
  const apiBase = await getApiBase();
  const resp = await fetch(`${apiBase}/api/personnel/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || "인사 시점 검증에 실패했습니다.");
  }
  return resp.json();
}

export async function fetchPersonnelReport(id) {
  const apiBase = await getApiBase();
  const resp = await fetch(`${apiBase}/api/personnel/reports/${encodeURIComponent(id)}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || "저장된 검증 기록을 불러오지 못했습니다.");
  }
  return resp.json();
}
