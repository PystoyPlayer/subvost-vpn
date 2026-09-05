// Public release metadata only. Never accepts subscription URLs or app configuration.
export const REPOSITORY = 'PystoyPlayer/subvost-vpn';
export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;

export function versionParts(tag) {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(tag ?? '');
  return match ? match.slice(1).map(n => Number(n ?? 0)) : null;
}

export function compareVersions(a, b) {
  const av = versionParts(a), bv = versionParts(b);
  if (!av || !bv) throw new Error('Invalid stable version');
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
  return 0;
}

export function classifyAsset(name) {
  let match = /^SubVost-VPN-macOS-(Legacy-)?(arm64|x86_64)-(\d+\.\d+(?:\.\d+)?)\.dmg$/.exec(name);
  if (match) return { os: 'macos', variant: match[1] ? 'legacy' : 'modern', arch: match[2], version: match[3], format: 'dmg' };
  match = /^SubVost-VPN-Linux-(x86_64|arm64|armv7)-(\d+\.\d+(?:\.\d+)?)(?:-(glibc|musl))?\.(AppImage|deb|rpm|tar\.gz|tar\.xz|pkg\.tar\.zst|flatpak|snap)$/.exec(name);
  if (match) return { os: 'linux', variant: match[3] ?? 'glibc', arch: match[1], version: match[2], format: match[4] };
  return null;
}

export function buildCatalog(releases) {
  if (!Array.isArray(releases)) throw new Error('GitHub returned an invalid release list');
  const builds = new Map();
  for (const release of releases) {
    if (release.draft || release.prerelease || !versionParts(release.tag_name)) continue;
    for (const asset of Array.isArray(release.assets) ? release.assets : []) {
      const info = classifyAsset(asset.name);
      if (!info || compareVersions(info.version, release.tag_name) !== 0) continue;
      const expected = `${RELEASES_URL}/download/${release.tag_name}/${asset.name}`;
      if (asset.browser_download_url !== expected || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
      const key = [info.os, info.variant, info.arch, info.format].join(':');
      const previous = builds.get(key);
      if (previous && compareVersions(previous.version, info.version) >= 0) continue;
      builds.set(key, {
        ...info, name: asset.name, url: expected, size: asset.size,
        sha256: /^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ? asset.digest.slice(7) : null,
        releaseUrl: `${RELEASES_URL}/tag/${release.tag_name}`,
        publishedAt: release.published_at ?? null,
      });
    }
  }
  return [...builds.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export function selectBuild(builds, { os, arch, variant, format }) {
  return builds.find(b => b.os === os && b.arch === arch && b.variant === variant && b.format === format) ?? null;
}

export function reconcileLinuxFormat(builds, state) {
  if (state.os !== 'linux') return state;
  const formats = [...new Set(builds.filter(b => b.os === state.os && b.arch === state.arch && b.variant === state.variant).map(b => b.format))];
  return formats.length && !formats.includes(state.format) ? { ...state, format: formats[0] } : state;
}
