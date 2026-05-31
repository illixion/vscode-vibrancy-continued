function buildWindowOptions(o, i, B, F5) {
  const u = {};
  !Bo(o, i?.forceNativeTitlebar ? "native" : $0(o, i)) && (u.titleBarStyle="hidden",B||(u.frame=!1),F5(o, i));
  return u;
}
