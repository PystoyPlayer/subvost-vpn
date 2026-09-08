// Public release metadata only. Never accepts subscription URLs or app configuration.
export const REPOSITORY = 'PystoyPlayer/subvost-vpn';
export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;

export function versionParts(tag) {
  if (typeof tag !== 'string' || tag.length > 256) return null;
  const match = /^(?:(?:windows|macos|linux|android)-)?v?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(tag);
  if (!match) return null;
  const core = match.slice(1, 4).map(n => Number(n ?? 0));
  const prerelease = match[4]?.split('.') ?? null;
  if (!core.every(Number.isSafeInteger) || prerelease?.some(n => /^0\d+$/.test(n))) return null;
  return [...core, prerelease];
}

export function compareVersions(a, b) {
  const av = versionParts(a), bv = versionParts(b);
  if (!av || !bv) throw new Error('Invalid release version');
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
  if (!av[3] || !bv[3]) return av[3] ? -1 : bv[3] ? 1 : 0;
  for (let i = 0; i < Math.max(av[3].length, bv[3].length); i++) {
    const a = av[3][i], b = bv[3][i];
    if (a === b) continue;
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    const an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
    if (an && bn && a.length !== b.length) return a.length - b.length;
    if (an !== bn) return an ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function classifyAsset(name) {
  const android = /^SubVost-VPN-Android-(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|preview)\.\d+)?)\.apk$/.exec(name);
  if (android) return { os: 'android', variant: 'mobile', arch: 'universal', version: android[1], format: 'apk' };
  const setup = /^SubVost-VPN-(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|preview)\.\d+)?)-Windows-(x64|arm64|x86)-Setup\.exe$/.exec(name);
  if (setup) return { os: 'windows', variant: 'desktop', arch: setup[2], version: setup[1], format: 'exe' };
  const windows = /^SubVost-VPN-Windows-(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|preview)\.\d+)?)-win-(x64|arm64|x86)\.zip$/.exec(name);
  if (windows) return { os: 'windows', variant: 'desktop', arch: windows[2], version: windows[1], format: 'zip' };
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
    const platform = /^(windows|macos|linux|android)-v/.exec(release.tag_name ?? '')?.[1];
    const version = versionParts(release.tag_name);
    const testing = Boolean(release.prerelease || version?.[3]);
    if (release.draft || !version || (testing && !['windows', 'android'].includes(platform))) continue;
    for (const asset of Array.isArray(release.assets) ? release.assets : []) {
      const info = classifyAsset(asset.name);
      if (!info || !versionParts(info.version) || (platform && info.os !== platform) || compareVersions(info.version, release.tag_name) !== 0) continue;
      const expected = `${RELEASES_URL}/download/${release.tag_name}/${asset.name}`;
      if (asset.browser_download_url !== expected || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
      const key = [info.os, info.variant, info.arch, info.format].join(':');
      const previous = builds.get(key);
      if (previous && compareVersions(previous.version, info.version) >= 0) continue;
      builds.set(key, {
        ...info, prerelease: testing, name: asset.name, url: expected, size: asset.size,
        sha256: /^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ? asset.digest.slice(7) : null,
        releaseUrl: `${RELEASES_URL}/tag/${release.tag_name}`,
        publishedAt: release.published_at ?? null,
      });
    }
  }
  return [...builds.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export function selectBuild(builds, { os, arch, variant, format }) {
  if (os === 'windows') {
    // Prefer an installer within the newest release, never an obsolete EXE
    // over a newer portable build, nor a build for another architecture.
    return builds.filter(b => b.os === os && b.arch === arch && b.variant === variant && ['exe', 'zip'].includes(b.format))
      .sort((a, b) => compareVersions(b.version, a.version) || Number(b.format === 'exe') - Number(a.format === 'exe'))[0] ?? null;
  }
  return builds.find(b => b.os === os && b.arch === arch && b.variant === variant && b.format === format) ?? null;
}

export function reconcileLinuxFormat(builds, state) {
  if (state.os !== 'linux') return state;
  const formats = [...new Set(builds.filter(b => b.os === state.os && b.arch === state.arch && b.variant === state.variant).map(b => b.format))];
  return formats.length && !formats.includes(state.format) ? { ...state, format: formats[0] } : state;
}
