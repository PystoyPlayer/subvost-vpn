// Only verified copies of the exact published asset become a mirror option.
export const MIRROR_ORIGIN = 'https://download.subvost.fun';
const PREFIX = 'https://github.com/PystoyPlayer/subvost-vpn/releases/download/';

export function downloadSource(build, manifest) {
  const fallback = { url: build.url, mirrored: false };
  if (!build.url?.startsWith(PREFIX) || manifest?.schema !== 1 || !Array.isArray(manifest.assets)) return fallback;
  const path = build.url.slice(PREFIX.length);
  if (!/^[A-Za-z0-9.+_-]+\/[A-Za-z0-9.+_-]+$/.test(path)) return fallback;
  const expected = `${MIRROR_ORIGIN}/releases/${path}`;
  const entry = manifest.assets.find(asset => asset.source === build.url);
  if (!entry || entry.url !== expected || entry.size !== build.size || !/^[a-f0-9]{64}$/.test(entry.sha256)) return fallback;
  if (build.sha256 && build.sha256 !== entry.sha256) return fallback;
  return { url: expected, mirrored: true };
}

// Source priority is a product decision, never a race between fetch responses.
export function downloadOptions(build, manifest) {
  const mirror = downloadSource(build, manifest);
  return {
    primary: build.url,
    alternate: mirror.mirrored ? mirror.url : `${MIRROR_ORIGIN}/files.html`,
    verifiedMirror: mirror.mirrored,
  };
}
