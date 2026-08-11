const BASE = "/leftturn".replace(/\/$/, "");
const u = (path) => {
  if (!path.startsWith("/")) return path;
  return `${BASE}${path}`;
};

export { u };
